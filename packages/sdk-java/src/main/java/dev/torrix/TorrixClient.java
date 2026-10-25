package dev.torrix;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Posts run records to a Torrix instance. Records are queued and delivered by a
 * background daemon thread so logging never blocks the request path; the queue
 * is flushed on {@link #close()} and can be flushed manually with {@link #flush}.
 *
 * <p>No external dependencies: uses {@code java.net.http} from the JDK and a
 * small internal JSON writer.
 */
public final class TorrixClient implements AutoCloseable {

    private static final Duration DEFAULT_TIMEOUT = Duration.ofSeconds(10);
    private static final Duration FLUSH_TIMEOUT = Duration.ofSeconds(5);
    private static final Pattern IDS_PATTERN = Pattern.compile("\"ids\"\\s*:\\s*\\[(.*?)]", Pattern.DOTALL);
    private static final Pattern STRING_PATTERN = Pattern.compile("\"((?:[^\"\\\\]|\\\\.)*)\"");

    private final String baseUrl;
    private final String apiKey;
    private final String project;
    private final boolean enabled;
    private final HttpClient http;
    private final BlockingQueue<List<Map<String, Object>>> queue = new LinkedBlockingQueue<>();
    private final ExecutorService worker;
    private final AtomicInteger pending = new AtomicInteger();
    private final AtomicReference<String> lastError = new AtomicReference<>();
    private volatile boolean closed;

    public TorrixClient(String apiKey) {
        this(apiKey, "http://localhost:8088", null, true, DEFAULT_TIMEOUT);
    }

    public TorrixClient(String apiKey, String baseUrl) {
        this(apiKey, baseUrl, null, true, DEFAULT_TIMEOUT);
    }

    public TorrixClient(String apiKey, String baseUrl, String project, boolean enabled, Duration timeout) {
        this.apiKey = apiKey == null ? "" : apiKey;
        this.baseUrl = trimTrailingSlash(baseUrl == null || baseUrl.isEmpty() ? "http://localhost:8088" : baseUrl);
        this.project = project;
        this.enabled = enabled;
        this.http = HttpClient.newBuilder()
                .connectTimeout(timeout == null ? DEFAULT_TIMEOUT : timeout)
                .build();
        this.worker = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "torrix-ingest");
            thread.setDaemon(true);
            return thread;
        });
        this.worker.execute(this::workerLoop);
    }

    public String baseUrl() {
        return baseUrl;
    }

    public boolean enabled() {
        return enabled;
    }

    public String lastError() {
        return lastError.get();
    }

    /** Queue one record; returns accepted ids only when {@code wait} is true. */
    public List<String> ingest(Map<String, Object> record) {
        return ingest(List.of(record), false);
    }

    public List<String> ingest(List<Map<String, Object>> records, boolean wait) {
        List<String> accepted = new ArrayList<>();
        if (!enabled || closed || records == null || records.isEmpty()) {
            return accepted;
        }
        for (int start = 0; start < records.size(); start += 500) {
            List<Map<String, Object>> batch = new ArrayList<>(records.subList(start, Math.min(start + 500, records.size())));
            if (batch.isEmpty()) {
                continue;
            }
            if (wait) {
                try {
                    accepted.addAll(send(batch));
                } catch (Exception exc) {
                    lastError.set(exc.getMessage());
                }
            } else {
                pending.incrementAndGet();
                queue.add(batch);
            }
        }
        return accepted;
    }

    /** Blocks until the queue drains or the timeout elapses. */
    public boolean flush(Duration timeout) {
        if (closed) {
            return true;
        }
        long deadline = System.nanoTime() + (timeout == null ? FLUSH_TIMEOUT : timeout).toNanos();
        while (pending.get() > 0 && System.nanoTime() < deadline) {
            try {
                Thread.sleep(10);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return pending.get() == 0;
            }
        }
        return pending.get() == 0;
    }

    public boolean health() {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/health"))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            return response.statusCode() == 200;
        } catch (Exception exc) {
            return false;
        }
    }

    @Override
    public void close() {
        if (closed) {
            return;
        }
        flush(FLUSH_TIMEOUT);
        closed = true;
        worker.shutdown();
        try {
            worker.awaitTermination(1, TimeUnit.SECONDS);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
        }
    }

    private void workerLoop() {
        while (!closed || !queue.isEmpty()) {
            List<Map<String, Object>> batch;
            try {
                batch = queue.poll(200, TimeUnit.MILLISECONDS);
            } catch (InterruptedException exc) {
                Thread.currentThread().interrupt();
                return;
            }
            if (batch == null) {
                continue;
            }
            try {
                send(batch);
            } catch (Exception exc) {
                lastError.set(exc.getMessage());
            } finally {
                pending.decrementAndGet();
            }
        }
    }

    private List<String> send(List<Map<String, Object>> batch) throws Exception {
        Map<String, Object> payload = new LinkedHashMap<>();
        payload.put("records", batch);
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(baseUrl + "/api/ingest"))
                .timeout(DEFAULT_TIMEOUT)
                .header("content-type", "application/json")
                .header("user-agent", "torrix-sdk-java/1.3.0")
                .POST(HttpRequest.BodyPublishers.ofString(Json.write(payload)));
        if (!apiKey.isEmpty()) {
            builder.header("authorization", "Bearer " + apiKey);
        }
        if (project != null && !project.isEmpty()) {
            builder.header("x-torrix-project", project);
        }
        HttpResponse<String> response = http.send(builder.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() >= 400) {
            throw new IllegalStateException("torrix ingest rejected with HTTP " + response.statusCode() + ": " + response.body());
        }
        return parseIds(response.body());
    }

    private static List<String> parseIds(String body) {
        List<String> ids = new ArrayList<>();
        if (body == null || body.isEmpty()) {
            return ids;
        }
        Matcher array = IDS_PATTERN.matcher(body);
        if (!array.find()) {
            return ids;
        }
        Matcher strings = STRING_PATTERN.matcher(array.group(1));
        while (strings.find()) {
            ids.add(strings.group(1));
        }
        return ids;
    }

    private static String trimTrailingSlash(String value) {
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') {
            end -= 1;
        }
        return value.substring(0, end);
    }

    /** Minimal JSON writer for the record shapes the ingest API accepts. */
    static final class Json {
        private Json() {
        }

        static String write(Object value) {
            StringBuilder out = new StringBuilder();
            append(out, value);
            return out.toString();
        }

        private static void append(StringBuilder out, Object value) {
            if (value == null) {
                out.append("null");
            } else if (value instanceof String) {
                quote(out, (String) value);
            } else if (value instanceof Number || value instanceof Boolean) {
                out.append(value);
            } else if (value instanceof Map) {
                out.append('{');
                boolean first = true;
                for (Map.Entry<?, ?> entry : ((Map<?, ?>) value).entrySet()) {
                    if (!first) {
                        out.append(',');
                    }
                    first = false;
                    quote(out, String.valueOf(entry.getKey()));
                    out.append(':');
                    append(out, entry.getValue());
                }
                out.append('}');
            } else if (value instanceof Iterable) {
                out.append('[');
                boolean first = true;
                for (Object item : (Iterable<?>) value) {
                    if (!first) {
                        out.append(',');
                    }
                    first = false;
                    append(out, item);
                }
                out.append(']');
            } else if (value instanceof Object[]) {
                out.append('[');
                Object[] array = (Object[]) value;
                for (int i = 0; i < array.length; i += 1) {
                    if (i > 0) {
                        out.append(',');
                    }
                    append(out, array[i]);
                }
                out.append(']');
            } else {
                quote(out, String.valueOf(value));
            }
        }

        private static void quote(StringBuilder out, String text) {
            out.append('"');
            for (int i = 0; i < text.length(); i += 1) {
                char ch = text.charAt(i);
                switch (ch) {
                    case '"':
                        out.append("\\\"");
                        break;
                    case '\\':
                        out.append("\\\\");
                        break;
                    case '\n':
                        out.append("\\n");
                        break;
                    case '\r':
                        out.append("\\r");
                        break;
                    case '\t':
                        out.append("\\t");
                        break;
                    default:
                        if (ch < 0x20) {
                            out.append(String.format("\\u%04x", (int) ch));
                        } else {
                            out.append(ch);
                        }
                }
            }
            out.append('"');
        }
    }
}
