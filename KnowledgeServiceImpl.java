import java.rmi.RemoteException;
import java.rmi.server.UnicastRemoteObject;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

public class KnowledgeServiceImpl extends UnicastRemoteObject
        implements KnowledgeService {

    private final KnowledgeRepository repository;
    private final VectorSearch vectorSearch;

    // Thread pool with 5 worker threads
    private final ExecutorService threadPool = Executors.newFixedThreadPool(5);

    // Lamport logical clock — incremented on every RMI call
    private long lamportClock = 0;

    public KnowledgeServiceImpl() throws RemoteException {
        super();
        repository = new KnowledgeRepository();
        vectorSearch = new VectorSearch();

        // Load existing chunks into TF-IDF index
        try {
            repository.initTables();
            rebuildIndex();
        } catch (Exception e) {
            System.out.println("[Service] Warning: Could not load existing chunks: " + e.getMessage());
        }
    }


    private void rebuildIndex() throws Exception {
        List<Object[]> chunks = repository.getAllChunks();
        vectorSearch.clear();

        for (Object[] chunk : chunks) {
            int id = (int) chunk[0];
            int docId = (int) chunk[1];
            String text = (String) chunk[2];
            vectorSearch.addChunk(id, docId, text);
        }

        vectorSearch.buildIndex();
        System.out.println("[Service] TF-IDF index loaded with " + chunks.size() + " chunks.");
    }


    @Override
    public String uploadDocument(String filename, String textContent) throws RemoteException {

        try {
            lamportClock++;

            System.out.println(
                    "[Lamport: " + lamportClock + "] "
                    + "Upload request: " + filename + " (" + textContent.length() + " chars)"
            );

            List<String> chunks = chunkText(textContent);

            Future<Integer> future = threadPool.submit(() -> {
                int docId = repository.insertDocument(filename, chunks.size());
                for (int i = 0; i < chunks.size(); i++) {
                    repository.insertChunk(docId, chunks.get(i), i);
                }
                return docId;
            });

            int docId = future.get();
            rebuildIndex();

            String msg = "Document '" + filename + "' uploaded successfully. "
                    + chunks.size() + " chunks indexed. (ID: " + docId + ")";

            System.out.println("[Service] " + msg);
            return msg;

        } catch (Exception e) {
            throw new RemoteException("Error uploading document: " + e.getMessage(), e);
        }
    }


    @Override
    public List<String> queryRAG(String question) throws RemoteException {
        return queryRAGByDoc(question, 0);
    }


    @Override
    public List<String> queryRAGByDoc(String question, int docId) throws RemoteException {

        try {
            lamportClock++;

            System.out.println(
                    "[Lamport: " + lamportClock + "] "
                    + "RAG query (docId=" + docId + "): \"" + question + "\""
            );

            List<VectorSearch.SearchResult> results = vectorSearch.search(question, 4, docId);
            List<String> responses = new ArrayList<>();

            if (results.isEmpty()) {
                responses.add("No relevant content found matching your query.");
            } else {
                for (VectorSearch.SearchResult result : results) {
                    String source;
                    try {
                        source = repository.getDocumentNameForChunk(result.chunkId);
                    } catch (Exception e) {
                        source = "Unknown";
                    }

                    String entry = String.format(
                            "Score: %.1f%%\nSource: %s\nContent: %s",
                            result.score * 100,
                            source,
                            result.text
                    );
                    responses.add(entry);
                }
            }

            System.out.println("[Service] Query returned " + results.size() + " matching chunks classified across documents.");
            return responses;

        } catch (Exception e) {
            throw new RemoteException("Error querying RAG: " + e.getMessage(), e);
        }
    }


    @Override
    public List<String> getDocuments() throws RemoteException {

        try {
            lamportClock++;
            System.out.println("[Lamport: " + lamportClock + "] Documents list requested");

            Future<List<String>> future = threadPool.submit(repository::getDocuments);
            return future.get();

        } catch (Exception e) {
            throw new RemoteException("Error listing documents: " + e.getMessage(), e);
        }
    }


    private List<String> chunkText(String text) {

        List<String> chunks = new ArrayList<>();
        String[] paragraphs = text.split("\\n\\s*\\n");
        StringBuilder currentChunk = new StringBuilder();

        for (String para : paragraphs) {
            para = para.trim();
            if (para.isEmpty()) continue;

            if (currentChunk.length() + para.length() > 500 && currentChunk.length() > 0) {
                chunks.add(currentChunk.toString().trim());
                currentChunk = new StringBuilder();
            }

            if (currentChunk.length() > 0) currentChunk.append("\n\n");
            currentChunk.append(para);

            if (currentChunk.length() > 500) {
                String longText = currentChunk.toString().trim();
                String[] sentences = longText.split("(?<=[.!?])\\s+");
                currentChunk = new StringBuilder();

                for (String sentence : sentences) {
                    if (currentChunk.length() + sentence.length() > 500 && currentChunk.length() > 0) {
                        chunks.add(currentChunk.toString().trim());
                        currentChunk = new StringBuilder();
                    }
                    if (currentChunk.length() > 0) currentChunk.append(" ");
                    currentChunk.append(sentence);
                }
            }
        }

        if (currentChunk.length() > 0) {
            chunks.add(currentChunk.toString().trim());
        }

        if (chunks.isEmpty() && !text.trim().isEmpty()) {
            String remaining = text.trim();
            while (remaining.length() > 0) {
                int end = Math.min(500, remaining.length());
                chunks.add(remaining.substring(0, end));
                remaining = remaining.substring(end);
            }
        }

        return chunks;
    }


    @Override
    public long getServerTime() throws RemoteException {
        lamportClock++;
        long serverTime = System.currentTimeMillis();
        System.out.println("[Lamport: " + lamportClock + "] Physical clock sync - Time: " + serverTime + " ms");
        return serverTime;
    }

    @Override
    public long getLamportTime(long clientLamportClock) throws RemoteException {
        long oldClock = lamportClock;
        lamportClock = Math.max(lamportClock, clientLamportClock) + 1;
        System.out.println("[Lamport Sync] Client: " + clientLamportClock + " | Server: " + oldClock + " -> " + lamportClock);
        return lamportClock;
    }

    @Override
    public long getServerLamportClock() throws RemoteException {
        return lamportClock;
    }
}