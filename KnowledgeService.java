import java.rmi.Remote;
import java.rmi.RemoteException;
import java.util.List;

public interface KnowledgeService extends Remote {

    // ===== RAG PIPELINE METHODS =====

    // Upload a document: receives filename and extracted text
    String uploadDocument(String filename, String textContent)
            throws RemoteException;

    // RAG query across ALL documents
    List<String> queryRAG(String question)
            throws RemoteException;

    // RAG query targeted at a specific document (docId = 0 for all)
    List<String> queryRAGByDoc(String question, int docId)
            throws RemoteException;

    // List all uploaded documents
    List<String> getDocuments()
            throws RemoteException;

    // ===== CLOCK SYNCHRONIZATION (infrastructure) =====

    long getServerTime() throws RemoteException;

    long getLamportTime(long clientLamportClock)
            throws RemoteException;

    long getServerLamportClock() throws RemoteException;
}
