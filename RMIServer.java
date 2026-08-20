import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;

public class RMIServer {

    public static void main(String[] args) {

        try {

            KnowledgeService service =
                    new KnowledgeServiceImpl();

            Registry registry =
                    LocateRegistry.createRegistry(1099);

            registry.rebind(
                    "KnowledgeService",
                    service
            );

            System.out.println(
                    "======================================"
            );
            System.out.println(
                    "   AUTONOMOUS KNOWLEDGE BASE SERVER"
            );
            System.out.println(
                    "======================================"
            );

            System.out.println(
                    "RMI Registry started on port 1099."
            );

            System.out.println(
                    "KnowledgeService is registered."
            );

            System.out.println(
                    "Server is ready and waiting for clients..."
            );

        } catch (Exception e) {

            System.out.println(
                    "Server error: " + e.getMessage()
            );

            e.printStackTrace();
        }
    }
}