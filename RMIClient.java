import java.io.File;
import java.nio.file.Files;
import java.rmi.registry.LocateRegistry;
import java.rmi.registry.Registry;
import java.util.List;
import java.util.Scanner;

public class RMIClient {

    // Client-side Lamport clock
    private static long lamportClock = 0;

    public static void main(String[] args) {

        try {

            Registry registry =
                    LocateRegistry.getRegistry(
                            "localhost", 1099
                    );

            KnowledgeService service =
                    (KnowledgeService)
                            registry.lookup(
                                    "KnowledgeService"
                            );

            Scanner scanner = new Scanner(System.in);

            System.out.println(
                    "======================================"
            );
            System.out.println(
                    "   AUTONOMOUS KNOWLEDGE BASE CLIENT"
            );
            System.out.println(
                    "        RAG Copilot Pipeline"
            );
            System.out.println(
                    "======================================"
            );

            // ------------------------------------------------
            // AUTO CLOCK SYNC (Cristian's + Lamport)
            // ------------------------------------------------

            long T1 = System.currentTimeMillis();
            long serverTime = service.getServerTime();
            long T4 = System.currentTimeMillis();
            long rtt = T4 - T1;
            long offset = (serverTime + rtt / 2) - T4;

            System.out.println(
                    "[SYNC] Clock synchronized. "
                    + "Offset: "
                    + (offset >= 0 ? "+" : "")
                    + offset + "ms | RTT: " + rtt + "ms"
            );

            lamportClock++;
            long serverLamport =
                    service.getLamportTime(lamportClock);
            lamportClock =
                    Math.max(lamportClock, serverLamport) + 1;

            System.out.println(
                    "[SYNC] Lamport aligned. "
                    + "Client: " + lamportClock
                    + " | Server: " + serverLamport
            );
            System.out.println("Ready.\n");

            // ------------------------------------------------
            // INTERACTIVE MENU
            // ------------------------------------------------

            while (true) {

                System.out.println("Choose an option:");
                System.out.println(
                        "1. Upload Document"
                );
                System.out.println(
                        "2. Ask Question (RAG)"
                );
                System.out.println(
                        "3. View Documents"
                );
                System.out.println("4. Exit");
                System.out.print("Enter choice: ");

                int choice = scanner.nextInt();
                scanner.nextLine();

                // ==========================================
                //  1. UPLOAD DOCUMENT
                // ==========================================

                if (choice == 1) {

                    lamportClock++;

                    System.out.print(
                            "Enter file path (.txt): "
                    );
                    String path = scanner.nextLine().trim();

                    File file = new File(path);

                    if (!file.exists()) {
                        System.out.println(
                                "File not found: " + path
                                + "\n"
                        );
                        continue;
                    }

                    String content = new String(
                            Files.readAllBytes(file.toPath())
                    );

                    String filename = file.getName();

                    System.out.println(
                            "Uploading " + filename
                            + " (" + content.length()
                            + " chars)..."
                    );

                    String result =
                            service.uploadDocument(
                                    filename, content
                            );

                    System.out.println(result);
                    System.out.println(
                            "[Lamport: " + lamportClock
                            + "]\n"
                    );


                // ==========================================
                //  2. ASK QUESTION (RAG)
                // ==========================================

                } else if (choice == 2) {

                    lamportClock++;

                    System.out.print(
                            "Ask a question: "
                    );
                    String question =
                            scanner.nextLine().trim();

                    if (question.isEmpty()) {
                        System.out.println(
                                "Empty question.\n"
                        );
                        continue;
                    }

                    List<String> results =
                            service.queryRAG(question);

                    System.out.println(
                            "\n========== RAG RESULTS =========="
                    );

                    for (int i = 0; i < results.size();
                         i++) {
                        System.out.println(
                                "--- Result " + (i + 1)
                                + " ---"
                        );
                        System.out.println(results.get(i));
                        System.out.println();
                    }

                    System.out.println(
                            "[Lamport: " + lamportClock
                            + "]\n"
                    );


                // ==========================================
                //  3. VIEW DOCUMENTS
                // ==========================================

                } else if (choice == 3) {

                    lamportClock++;

                    List<String> docs =
                            service.getDocuments();

                    System.out.println(
                            "\n========== DOCUMENTS =========="
                    );

                    if (docs.isEmpty()) {
                        System.out.println(
                                "No documents uploaded yet."
                        );
                    } else {
                        for (String doc : docs) {
                            System.out.println(doc);
                        }
                    }

                    System.out.println(
                            "[Lamport: " + lamportClock
                            + "]\n"
                    );


                // ==========================================
                //  4. EXIT
                // ==========================================

                } else if (choice == 4) {

                    System.out.println(
                            "Client terminated."
                    );
                    break;

                } else {
                    System.out.println(
                            "Invalid choice.\n"
                    );
                }
            }

            scanner.close();

        } catch (Exception e) {

            System.out.println(
                    "Client error: " + e.getMessage()
            );
            e.printStackTrace();
        }
    }
}