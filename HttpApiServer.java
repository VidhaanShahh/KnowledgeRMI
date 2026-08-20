import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.*;
import java.net.InetSocketAddress;
import java.nio.file.*;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.List;

/**
 * HTTP-to-RMI Bridge Server
 *
 * Exposes the RAG pipeline + clock sync status as REST endpoints
 * for the web dashboard. PDF text extraction happens browser-side.
 *
 * Start: java -cp ".;mysql-connector-j-26.7.0.jar" HttpApiServer
 * Dashboard: http://localhost:8080
 */
public class HttpApiServer {

    private static KnowledgeService service;

    // Clock sync state
    private static long lamportClock = 0;
    private static long physicalClockOffset = 0;
    private static long lastRTT = 0;
    private static String lastSyncTime = "Never";
    private static int syncCount = 0;
    private static long startTime;

    private static final SimpleDateFormat DATE_FMT =
            new SimpleDateFormat("yyyy-MM-dd HH:mm:ss");

    public static void main(String[] args) {

        try {
            startTime = System.currentTimeMillis();

            // Connect to RMI
            Registry registry = LocateRegistry.getRegistry("localhost", 1099);
            service = (KnowledgeService) registry.lookup("KnowledgeService");

            System.out.println("[HTTP] Connected to RMI");

            // Auto clock sync
            performClockSync();

            // Start HTTP server
            HttpServer server = HttpServer.create(new InetSocketAddress(8080), 0);

            // RAG endpoints
            server.createContext("/api/upload", new UploadHandler());
            server.createContext("/api/query", new QueryHandler());
            server.createContext("/api/documents", new DocumentsHandler());

            // Clock sync endpoints
            server.createContext("/api/status", new StatusHandler());
            server.createContext("/api/sync", new SyncHandler());

            // Static files
            server.createContext("/", new StaticFileHandler());

            server.setExecutor(null);
            server.start();

            System.out.println("[HTTP] Dashboard: http://localhost:8080");

        } catch (Exception e) {
            System.out.println("[HTTP] Error: " + e.getMessage());
            e.printStackTrace();
        }
    }


    private static synchronized void performClockSync() {

        try {
            long T1 = System.currentTimeMillis();
            long serverTime = service.getServerTime();
            long T4 = System.currentTimeMillis();

            lastRTT = T4 - T1;
            physicalClockOffset = (serverTime + lastRTT / 2) - T4;

            lamportClock++;
            long serverLamport = service.getLamportTime(lamportClock);
            lamportClock = Math.max(lamportClock, serverLamport) + 1;

            syncCount++;
            lastSyncTime = DATE_FMT.format(new Date());

            System.out.println(
                    "[SYNC] #" + syncCount
                    + " | Offset: " + (physicalClockOffset >= 0 ? "+" : "") + physicalClockOffset + "ms"
                    + " | RTT: " + lastRTT + "ms"
                    + " | Lamport: " + lamportClock
            );

        } catch (Exception e) {
            System.out.println("[SYNC] Failed: " + e.getMessage());
        }
    }


    /**
     * POST /api/upload
     * Body: {"filename":"doc.pdf","textContent":"..."}
     */
    static class UploadHandler implements HttpHandler {

        @Override
        public void handle(HttpExchange exchange) throws IOException {

            setCorsHeaders(exchange);

            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            if (!"POST".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"POST required\"}");
                return;
            }

            lamportClock++;

            String body = readBody(exchange);
            String filename = extractJsonValue(body, "filename");
            String textContent = extractJsonValue(body, "textContent");

            if (filename == null || textContent == null || textContent.trim().isEmpty()) {
                sendJson(exchange, 400, "{\"error\":\"Missing filename or textContent\"}");
                return;
            }

            try {
                String result = service.uploadDocument(filename, textContent);
                sendJson(exchange, 200, "{\"message\":\"" + escapeJson(result) + "\"}");
            } catch (Exception e) {
                sendJson(exchange, 500, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
            }
        }
    }


    /**
     * GET /api/query?q=question&docId=X
     */
    static class QueryHandler implements HttpHandler {

        @Override
        public void handle(HttpExchange exchange) throws IOException {

            setCorsHeaders(exchange);

            if (!"GET".equals(exchange.getRequestMethod())) {
                sendJson(exchange, 405, "{\"error\":\"GET required\"}");
                return;
            }

            lamportClock++;

            String rawQuery = exchange.getRequestURI().getQuery();
            if (rawQuery == null) {
                sendJson(exchange, 400, "{\"error\":\"Missing query parameter\"}");
                return;
            }

            String question = "";
            int docId = 0;

            String[] params = rawQuery.split("&");
            for (String param : params) {
                if (param.startsWith("q=")) {
                    question = java.net.URLDecoder.decode(param.substring(2), "UTF-8");
                } else if (param.startsWith("docId=")) {
                    try {
                        docId = Integer.parseInt(param.substring(6));
                    } catch (NumberFormatException ignored) {}
                }
            }

            if (question.trim().isEmpty()) {
                sendJson(exchange, 400, "{\"error\":\"Question is empty\"}");
                return;
            }

            try {
                List<String> results = service.queryRAGByDoc(question, docId);
                StringBuilder sb = new StringBuilder("[");

                for (int i = 0; i < results.size(); i++) {
                    if (i > 0) sb.append(",");

                    String item = results.get(i);
                    String score = "0";
                    String source = "Unknown";
                    String content = item;

                    String[] lines = item.split("\n");
                    for (String line : lines) {
                        if (line.startsWith("Score:")) {
                            score = line.substring(6).trim().replace("%", "");
                        } else if (line.startsWith("Source:")) {
                            source = line.substring(7).trim();
                        } else if (line.startsWith("Content:")) {
                            content = line.substring(8).trim();
                        }
                    }

                    sb.append("{\"score\":\"").append(escapeJson(score))
                            .append("\",\"source\":\"").append(escapeJson(source))
                            .append("\",\"content\":\"").append(escapeJson(content))
                            .append("\"}");
                }

                sb.append("]");
                sendJson(exchange, 200, sb.toString());

            } catch (Exception e) {
                sendJson(exchange, 500, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
            }
        }
    }


    /**
     * GET /api/documents
     */
    static class DocumentsHandler implements HttpHandler {

        @Override
        public void handle(HttpExchange exchange) throws IOException {

            setCorsHeaders(exchange);
            lamportClock++;

            try {
                List<String> docs = service.getDocuments();
                StringBuilder sb = new StringBuilder("[");

                for (int i = 0; i < docs.size(); i++) {
                    if (i > 0) sb.append(",");
                    String doc = docs.get(i);

                    String id = "", filename = "", uploaded = "", chunks = "";
                    String[] parts = doc.split("\\|");
                    for (String part : parts) {
                        part = part.trim();
                        if (part.startsWith("ID:")) {
                            id = part.substring(3).trim();
                        } else if (part.startsWith("Filename:")) {
                            filename = part.substring(9).trim();
                        } else if (part.startsWith("Uploaded:")) {
                            uploaded = part.substring(9).trim();
                        } else if (part.startsWith("Chunks:")) {
                            chunks = part.substring(7).trim();
                        }
                    }

                    sb.append("{\"id\":\"").append(escapeJson(id))
                            .append("\",\"filename\":\"").append(escapeJson(filename))
                            .append("\",\"uploaded\":\"").append(escapeJson(uploaded))
                            .append("\",\"chunks\":\"").append(escapeJson(chunks))
                            .append("\"}");
                }

                sb.append("]");
                sendJson(exchange, 200, sb.toString());

            } catch (Exception e) {
                sendJson(exchange, 500, "{\"error\":\"" + escapeJson(e.getMessage()) + "\"}");
            }
        }
    }


    static class StatusHandler implements HttpHandler {

        @Override
        public void handle(HttpExchange exchange) throws IOException {

            setCorsHeaders(exchange);
            long uptimeMs = System.currentTimeMillis() - startTime;

            long serverLamport = 0;
            try {
                serverLamport = service.getServerLamportClock();
            } catch (Exception ignored) {}

            String status = Math.abs(physicalClockOffset) < 100 ? "SYNCHRONIZED" : "DRIFT_DETECTED";

            String json = "{"
                + "\"serverUptime\":\"" + formatUptime(uptimeMs) + "\""
                + ",\"physicalClockOffset\":" + physicalClockOffset
                + ",\"lastSyncTime\":\"" + lastSyncTime + "\""
                + ",\"roundTripTime\":" + lastRTT
                + ",\"clientLamportClock\":" + lamportClock
                + ",\"serverLamportClock\":" + serverLamport
                + ",\"syncCount\":" + syncCount
                + ",\"status\":\"" + status + "\""
                + "}";

            sendJson(exchange, 200, json);
        }
    }

    static class SyncHandler implements HttpHandler {

        @Override
        public void handle(HttpExchange exchange) throws IOException {

            setCorsHeaders(exchange);

            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            performClockSync();

            String json = "{\"message\":\"Sync complete\""
                    + ",\"syncCount\":" + syncCount
                    + ",\"offset\":" + physicalClockOffset
                    + ",\"rtt\":" + lastRTT
                    + ",\"lamportClock\":" + lamportClock
                    + "}";

            sendJson(exchange, 200, json);
        }
    }


    static class StaticFileHandler implements HttpHandler {

        @Override
        public void handle(HttpExchange exchange) throws IOException {

            String path = exchange.getRequestURI().getPath();
            if ("/".equals(path)) {
                path = "/index.html";
            }

            File file = new File("web" + path);

            if (!file.exists() || file.isDirectory()) {
                sendResponse(exchange, 404, "Not Found");
                return;
            }

            String ct = "text/plain";
            if (path.endsWith(".html")) ct = "text/html";
            else if (path.endsWith(".css")) ct = "text/css";
            else if (path.endsWith(".js")) ct = "application/javascript";
            else if (path.endsWith(".png")) ct = "image/png";
            else if (path.endsWith(".svg")) ct = "image/svg+xml";

            exchange.getResponseHeaders().add("Content-Type", ct + "; charset=UTF-8");

            byte[] bytes = Files.readAllBytes(file.toPath());
            exchange.sendResponseHeaders(200, bytes.length);

            OutputStream os = exchange.getResponseBody();
            os.write(bytes);
            os.close();
        }
    }


    private static void setCorsHeaders(HttpExchange exchange) {
        exchange.getResponseHeaders().add("Access-Control-Allow-Origin", "*");
        exchange.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        exchange.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
        exchange.getResponseHeaders().add("Content-Type", "application/json");
    }

    private static void sendJson(HttpExchange exchange, int code, String json) throws IOException {
        byte[] bytes = json.getBytes("UTF-8");
        exchange.sendResponseHeaders(code, bytes.length);
        OutputStream os = exchange.getResponseBody();
        os.write(bytes);
        os.close();
    }

    private static void sendResponse(HttpExchange exchange, int code, String body) throws IOException {
        byte[] bytes = body.getBytes("UTF-8");
        exchange.sendResponseHeaders(code, bytes.length);
        OutputStream os = exchange.getResponseBody();
        os.write(bytes);
        os.close();
    }

    private static String readBody(HttpExchange exchange) throws IOException {
        InputStream is = exchange.getRequestBody();
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[4096];
        int len;
        while ((len = is.read(tmp)) != -1) {
            buf.write(tmp, 0, len);
        }
        return buf.toString("UTF-8");
    }

    private static String extractJsonValue(String json, String key) {
        String search = "\"" + key + "\"";
        int idx = json.indexOf(search);
        if (idx < 0) return null;

        int colonIdx = json.indexOf(':', idx + search.length());
        if (colonIdx < 0) return null;

        int startQuote = json.indexOf('"', colonIdx + 1);
        if (startQuote < 0) return null;

        StringBuilder value = new StringBuilder();
        int i = startQuote + 1;
        while (i < json.length()) {
            char c = json.charAt(i);
            if (c == '\\' && i + 1 < json.length()) {
                char next = json.charAt(i + 1);
                if (next == '"') {
                    value.append('"');
                    i += 2;
                    continue;
                } else if (next == 'n') {
                    value.append('\n');
                    i += 2;
                    continue;
                } else if (next == '\\') {
                    value.append('\\');
                    i += 2;
                    continue;
                }
            }
            if (c == '"') break;
            value.append(c);
            i++;
        }

        return value.toString();
    }

    private static String escapeJson(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\")
                .replace("\"", "\\\"")
                .replace("\n", "\\n")
                .replace("\r", "")
                .replace("\t", "\\t");
    }

    private static String formatUptime(long ms) {
        long s = ms / 1000;
        long m = s / 60;
        long h = m / 60;
        m = m % 60;
        s = s % 60;
        if (h > 0) return h + "h " + m + "m";
        if (m > 0) return m + "m " + s + "s";
        return s + "s";
    }
}
