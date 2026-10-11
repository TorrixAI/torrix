package dev.torrix;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/** Process-wide convenience facade mirroring the Python and .NET SDKs. */
public final class Torrix {

    private static volatile TorrixClient defaultClient;

    private Torrix() {
    }

    public static TorrixClient init(String apiKey) {
        defaultClient = new TorrixClient(apiKey);
        return defaultClient;
    }

    public static TorrixClient init(String apiKey, String baseUrl) {
        defaultClient = new TorrixClient(apiKey, baseUrl);
        return defaultClient;
    }

    public static TorrixClient init(String apiKey, String baseUrl, String project, boolean enabled) {
        defaultClient = new TorrixClient(apiKey, baseUrl, project, enabled, Duration.ofSeconds(10));
        return defaultClient;
    }

    public static TorrixClient current() {
        return defaultClient;
    }

    public static TorrixClient getClient() {
        TorrixClient client = defaultClient;
        if (client == null) {
            throw new IllegalStateException("torrix not initialized: call Torrix.init() first");
        }
        return client;
    }

    public static List<String> ingest(Map<String, Object> record) {
        TorrixClient client = defaultClient;
        return client == null ? List.of() : client.ingest(record);
    }

    public static List<String> ingest(List<Map<String, Object>> records, boolean wait) {
        TorrixClient client = defaultClient;
        return client == null ? List.of() : client.ingest(records, wait);
    }

    public static boolean flush() {
        TorrixClient client = defaultClient;
        return client == null || client.flush(Duration.ofSeconds(5));
    }

    public static boolean flush(Duration timeout) {
        TorrixClient client = defaultClient;
        return client == null || client.flush(timeout);
    }

    public static boolean health() {
        TorrixClient client = defaultClient;
        return client != null && client.health();
    }
}
