import java.util.*;

/**
 * Enhanced Hybrid Vector Search Engine (TF-IDF + Substring Keyword Fallback)
 *
 * Implements robust RAG chunk retrieval:
 * 1. Tokenizes text into terms
 * 2. Computes Smoothed TF-IDF vectors per chunk (avoids 0.0 IDF for single/common docs)
 * 3. Computes Cosine Similarity
 * 4. Fallback Keyword/Phrase matching if vector similarity returns 0 results
 *
 * Pure Java — no external libraries required.
 */
public class VectorSearch {

    private final Map<Integer, String> chunkTexts = new HashMap<>();
    private final Map<Integer, Integer> chunkDocIds = new HashMap<>();
    private final Map<Integer, List<String>> chunkTokens = new HashMap<>();
    private final Map<Integer, Map<String, Double>> tfidfVectors = new HashMap<>();
    private final Map<String, Double> idfMap = new HashMap<>();
    private int totalChunks = 0;

    private static final Set<String> STOP_WORDS = new HashSet<>(Arrays.asList(
        "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "shall", "can", "to", "of", "in", "for",
        "on", "with", "at", "by", "from", "as", "into", "through", "during",
        "before", "after", "above", "below", "between", "and", "but", "or",
        "nor", "not", "so", "yet", "it", "its", "this", "that", "these", "those",
        "i", "me", "my", "we", "our", "you", "your", "he", "him", "his",
        "she", "her", "they", "them", "their", "what", "which", "who", "whom",
        "if", "then", "else", "when", "where", "how", "all", "each", "every",
        "both", "few", "more", "most", "other", "some", "such", "no", "only",
        "same", "than", "too", "very", "just", "also"
    ));


    public synchronized void addChunk(int chunkId, int docId, String text) {
        chunkTexts.put(chunkId, text);
        chunkDocIds.put(chunkId, docId);

        List<String> tokens = tokenize(text);
        chunkTokens.put(chunkId, tokens);
        totalChunks = chunkTexts.size();
    }


    public synchronized void buildIndex() {

        totalChunks = chunkTexts.size();
        if (totalChunks == 0) return;

        Map<String, Integer> docFreq = new HashMap<>();
        for (List<String> tokens : chunkTokens.values()) {
            Set<String> uniqueWords = new HashSet<>(tokens);
            for (String word : uniqueWords) {
                docFreq.merge(word, 1, Integer::sum);
            }
        }

        // Smoothed IDF to ensure terms never get 0 weight: log(1 + N / df) + 1
        idfMap.clear();
        for (Map.Entry<String, Integer> entry : docFreq.entrySet()) {
            double idf = Math.log(1.0 + ((double) totalChunks / entry.getValue())) + 1.0;
            idfMap.put(entry.getKey(), idf);
        }

        tfidfVectors.clear();
        for (Map.Entry<Integer, List<String>> entry : chunkTokens.entrySet()) {
            int chunkId = entry.getKey();
            List<String> tokens = entry.getValue();

            Map<String, Double> tfidf = computeTfIdf(tokens);
            tfidfVectors.put(chunkId, tfidf);
        }

        System.out.println(
                "[VectorSearch] Enhanced Index built: "
                + totalChunks + " chunks, "
                + idfMap.size() + " unique terms"
        );
    }


    public synchronized List<SearchResult> search(String query, int topK, int docId) {

        if (totalChunks == 0) {
            return Collections.emptyList();
        }

        List<String> queryTokens = tokenize(query);
        Map<String, Double> queryVector = computeTfIdf(queryTokens);

        List<SearchResult> results = new ArrayList<>();

        for (Map.Entry<Integer, Map<String, Double>> entry : tfidfVectors.entrySet()) {
            int chunkId = entry.getKey();

            if (docId > 0) {
                int chunkDocId = chunkDocIds.getOrDefault(chunkId, 0);
                if (chunkDocId != docId) continue;
            }

            Map<String, Double> chunkVector = entry.getValue();
            double similarity = cosineSimilarity(queryVector, chunkVector);

            if (similarity > 0.0) {
                results.add(new SearchResult(chunkId, chunkTexts.get(chunkId), similarity));
            }
        }

        // Fallback: If vector search yields 0 results, run Keyword Substring Overlap search
        if (results.isEmpty()) {
            List<String> queryWords = tokenize(query);

            for (Map.Entry<Integer, String> entry : chunkTexts.entrySet()) {
                int chunkId = entry.getKey();

                if (docId > 0) {
                    int chunkDocId = chunkDocIds.getOrDefault(chunkId, 0);
                    if (chunkDocId != docId) continue;
                }

                String textLower = entry.getValue().toLowerCase();
                int matchCount = 0;

                for (String word : queryWords) {
                    if (word.length() >= 2 && textLower.contains(word)) {
                        matchCount++;
                    }
                }

                if (matchCount > 0) {
                    double fallbackScore = 0.5 + (0.5 * matchCount / queryWords.size());
                    results.add(new SearchResult(chunkId, entry.getValue(), Math.min(fallbackScore, 0.95)));
                }
            }
        }

        // Sort descending by relevance score
        results.sort((a, b) -> Double.compare(b.score, a.score));

        if (results.size() > topK) {
            return results.subList(0, topK);
        }

        return results;
    }

    public synchronized List<SearchResult> search(String query, int topK) {
        return search(query, topK, 0);
    }


    public synchronized void clear() {
        chunkTexts.clear();
        chunkDocIds.clear();
        chunkTokens.clear();
        tfidfVectors.clear();
        idfMap.clear();
        totalChunks = 0;
    }


    public int getChunkCount() {
        return totalChunks;
    }


    private List<String> tokenize(String text) {
        List<String> tokens = new ArrayList<>();
        String[] words = text.toLowerCase().replaceAll("[^a-z0-9\\s]", " ").split("\\s+");

        for (String word : words) {
            word = word.trim();
            if (word.length() >= 2 && !STOP_WORDS.contains(word)) {
                tokens.add(word);
            }
        }
        return tokens;
    }


    private Map<String, Double> computeTfIdf(List<String> tokens) {
        Map<String, Double> vector = new HashMap<>();
        if (tokens.isEmpty()) return vector;

        Map<String, Integer> tf = new HashMap<>();
        for (String token : tokens) {
            tf.merge(token, 1, Integer::sum);
        }

        double totalTokens = tokens.size();
        for (Map.Entry<String, Integer> entry : tf.entrySet()) {
            String word = entry.getKey();
            double termFreq = entry.getValue() / totalTokens;
            double idf = idfMap.getOrDefault(word, 1.0);
            vector.put(word, termFreq * idf);
        }

        return vector;
    }


    private double cosineSimilarity(Map<String, Double> vectorA, Map<String, Double> vectorB) {
        double dotProduct = 0.0;
        for (Map.Entry<String, Double> entry : vectorA.entrySet()) {
            String word = entry.getKey();
            if (vectorB.containsKey(word)) {
                dotProduct += entry.getValue() * vectorB.get(word);
            }
        }

        if (dotProduct == 0.0) return 0.0;

        double magA = 0.0;
        for (double v : vectorA.values()) magA += v * v;
        magA = Math.sqrt(magA);

        double magB = 0.0;
        for (double v : vectorB.values()) magB += v * v;
        magB = Math.sqrt(magB);

        if (magA == 0.0 || magB == 0.0) return 0.0;

        return dotProduct / (magA * magB);
    }


    public static class SearchResult implements java.io.Serializable {
        private static final long serialVersionUID = 1L;

        public final int chunkId;
        public final String text;
        public final double score;

        public SearchResult(int chunkId, String text, double score) {
            this.chunkId = chunkId;
            this.text = text;
            this.score = score;
        }

        @Override
        public String toString() {
            return String.format(
                    "[%.2f%%] %s",
                    score * 100,
                    text.length() > 120 ? text.substring(0, 120) + "..." : text
            );
        }
    }
}
