package dev.torrix;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Builds the headers needed to route a provider call through the Torrix
 * {@code /proxy} pipeline with the JDK {@link java.net.http.HttpClient}.
 *
 * <pre>{@code
 * TorrixProxy proxy = TorrixProxy.builder()
 *     .torrixBaseUrl("http://localhost:8088")
 *     .torrixApiKey("trxk_...")
 *     .targetBaseUrl("https://api.openai.com/v1")
 *     .upstreamAuthorization("Bearer sk-...")
 *     .agentName("checkout-agent")
 *     .build();
 *
 * HttpRequest.Builder request = HttpRequest.newBuilder(proxy.endpoint("/v1/chat/completions"))
 *     .header("content-type", "application/json")
 *     .POST(HttpRequest.BodyPublishers.ofString(body));
 * proxy.apply(request, "/v1/chat/completions");
 * }</pre>
 */
public final class TorrixProxy {

    private final String torrixBaseUrl;
    private final String torrixApiKey;
    private final String targetBaseUrl;
    private final String upstreamAuthorization;
    private final String upstreamApiKey;
    private final String project;
    private final String agentName;
    private final String sessionId;
    private final String traceId;
    private final String runName;

    private TorrixProxy(Builder builder) {
        this.torrixBaseUrl = trimTrailingSlash(builder.torrixBaseUrl);
        this.torrixApiKey = builder.torrixApiKey;
        this.targetBaseUrl = trimTrailingSlash(builder.targetBaseUrl);
        this.upstreamAuthorization = builder.upstreamAuthorization;
        this.upstreamApiKey = builder.upstreamApiKey;
        this.project = builder.project;
        this.agentName = builder.agentName;
        this.sessionId = builder.sessionId;
        this.traceId = builder.traceId;
        this.runName = builder.runName;
    }

    public static Builder builder() {
        return new Builder();
    }

    /** The Torrix URL that corresponds to a provider path such as {@code /v1/chat/completions}. */
    public URI endpoint(String providerPath) {
        String path = providerPath == null || providerPath.isEmpty() ? "/" : providerPath;
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        return URI.create(torrixBaseUrl + "/proxy" + path);
    }

    /** The upstream URL the request should be forwarded to. */
    public String targetUrl(String providerPath) {
        String path = providerPath == null || providerPath.isEmpty() ? "/" : providerPath;
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        return targetBaseUrl + path;
    }

    /** Mutates the request builder with Torrix auth, metadata and upstream headers. */
    public void apply(java.net.http.HttpRequest.Builder request, String providerPath) {
        for (Map.Entry<String, String> header : headers(providerPath).entrySet()) {
            request.header(header.getKey(), header.getValue());
        }
    }

    public Map<String, String> headers(String providerPath) {
        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("x-target-url", targetUrl(providerPath));
        if (torrixApiKey != null && !torrixApiKey.isEmpty()) {
            headers.put("authorization", "Bearer " + torrixApiKey);
        }
        if (upstreamAuthorization != null && !upstreamAuthorization.isEmpty()) {
            headers.put("x-upstream-authorization", upstreamAuthorization);
        }
        if (upstreamApiKey != null && !upstreamApiKey.isEmpty()) {
            headers.put("x-upstream-api-key", upstreamApiKey);
        }
        if (project != null && !project.isEmpty()) {
            headers.put("x-torrix-project", project);
        }
        if (agentName != null && !agentName.isEmpty()) {
            headers.put("x-agent-name", agentName);
        }
        if (sessionId != null && !sessionId.isEmpty()) {
            headers.put("x-torrix-session", sessionId);
        }
        if (traceId != null && !traceId.isEmpty()) {
            headers.put("x-torrix-trace", traceId);
        }
        if (runName != null && !runName.isEmpty()) {
            headers.put("x-torrix-name", runName);
        }
        return headers;
    }

    private static String trimTrailingSlash(String value) {
        if (value == null || value.isEmpty()) {
            return value;
        }
        int end = value.length();
        while (end > 0 && value.charAt(end - 1) == '/') {
            end -= 1;
        }
        return value.substring(0, end);
    }

    public static final class Builder {
        private String torrixBaseUrl = "http://localhost:8088";
        private String torrixApiKey;
        private String targetBaseUrl = "";
        private String upstreamAuthorization;
        private String upstreamApiKey;
        private String project;
        private String agentName;
        private String sessionId;
        private String traceId;
        private String runName;

        public Builder torrixBaseUrl(String value) {
            this.torrixBaseUrl = value;
            return this;
        }

        public Builder torrixApiKey(String value) {
            this.torrixApiKey = value;
            return this;
        }

        public Builder targetBaseUrl(String value) {
            this.targetBaseUrl = value == null ? "" : value;
            return this;
        }

        public Builder upstreamAuthorization(String value) {
            this.upstreamAuthorization = value;
            return this;
        }

        public Builder upstreamApiKey(String value) {
            this.upstreamApiKey = value;
            return this;
        }

        public Builder project(String value) {
            this.project = value;
            return this;
        }

        public Builder agentName(String value) {
            this.agentName = value;
            return this;
        }

        public Builder sessionId(String value) {
            this.sessionId = value;
            return this;
        }

        public Builder traceId(String value) {
            this.traceId = value;
            return this;
        }

        public Builder runName(String value) {
            this.runName = value;
            return this;
        }

        public TorrixProxy build() {
            if (targetBaseUrl == null || targetBaseUrl.isEmpty()) {
                throw new IllegalStateException("targetBaseUrl is required");
            }
            return new TorrixProxy(this);
        }
    }
}
