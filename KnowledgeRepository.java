import java.sql.*;
import java.util.ArrayList;
import java.util.List;

/**
 * Database repository for the RAG pipeline.
 *
 * Tables:
 *   documents (id, filename, upload_date, chunk_count)
 *   chunks    (id, document_id, chunk_text, chunk_index)
 *
 * Tables are auto-created on first use.
 */
public class KnowledgeRepository {

    private boolean tablesInitialized = false;

    /**
     * Auto-create tables if they don't exist.
     */
    public void initTables() throws Exception {

        if (tablesInitialized) return;

        try (Connection con = DatabaseConnection.getConnection();
             Statement stmt = con.createStatement()) {

            stmt.executeUpdate(
                "CREATE TABLE IF NOT EXISTS documents ("
                + "id INT AUTO_INCREMENT PRIMARY KEY, "
                + "filename VARCHAR(255) NOT NULL, "
                + "upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP, "
                + "chunk_count INT DEFAULT 0"
                + ")"
            );

            stmt.executeUpdate(
                "CREATE TABLE IF NOT EXISTS chunks ("
                + "id INT AUTO_INCREMENT PRIMARY KEY, "
                + "document_id INT NOT NULL, "
                + "chunk_text TEXT NOT NULL, "
                + "chunk_index INT NOT NULL, "
                + "FOREIGN KEY (document_id) "
                + "REFERENCES documents(id)"
                + ")"
            );

            tablesInitialized = true;

            System.out.println("[Repository] Tables initialized.");
        }
    }


    public int insertDocument(String filename, int chunkCount) throws Exception {

        initTables();
        String sql = "INSERT INTO documents (filename, chunk_count) VALUES (?, ?)";

        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)) {

            ps.setString(1, filename);
            ps.setInt(2, chunkCount);
            ps.executeUpdate();

            ResultSet keys = ps.getGeneratedKeys();
            if (keys.next()) {
                return keys.getInt(1);
            }
        }

        return -1;
    }


    public void insertChunk(int documentId, String chunkText, int chunkIndex) throws Exception {

        initTables();
        String sql = "INSERT INTO chunks (document_id, chunk_text, chunk_index) VALUES (?, ?, ?)";

        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement(sql)) {

            ps.setInt(1, documentId);
            ps.setString(2, chunkText);
            ps.setInt(3, chunkIndex);
            ps.executeUpdate();
        }
    }


    /**
     * Get chunk ID, document ID, and text for all chunks.
     * Used to rebuild TF-IDF index.
     */
    public List<Object[]> getAllChunks() throws Exception {

        initTables();
        List<Object[]> chunks = new ArrayList<>();
        String sql = "SELECT id, document_id, chunk_text FROM chunks";

        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {

            while (rs.next()) {
                chunks.add(new Object[]{
                        rs.getInt("id"),
                        rs.getInt("document_id"),
                        rs.getString("chunk_text")
                });
            }
        }

        return chunks;
    }


    /**
     * Get all uploaded documents.
     */
    public List<String> getDocuments() throws Exception {

        initTables();
        List<String> results = new ArrayList<>();
        String sql = "SELECT id, filename, upload_date, chunk_count FROM documents ORDER BY id DESC";

        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement(sql);
             ResultSet rs = ps.executeQuery()) {

            while (rs.next()) {
                results.add(
                        "ID: " + rs.getInt("id")
                        + " | Filename: " + rs.getString("filename")
                        + " | Uploaded: " + rs.getString("upload_date")
                        + " | Chunks: " + rs.getInt("chunk_count")
                );
            }
        }

        return results;
    }


    public String getDocumentNameForChunk(int chunkId) throws Exception {

        initTables();
        String sql = "SELECT d.filename FROM documents d "
                + "JOIN chunks c ON c.document_id = d.id "
                + "WHERE c.id = ?";

        try (Connection con = DatabaseConnection.getConnection();
             PreparedStatement ps = con.prepareStatement(sql)) {

            ps.setInt(1, chunkId);
            ResultSet rs = ps.executeQuery();
            if (rs.next()) {
                return rs.getString("filename");
            }
        }

        return "Unknown";
    }
}