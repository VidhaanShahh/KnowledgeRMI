import java.time.LocalTime;

public class BerkeleyClock {

    // Represents a computer/node in the distributed system
    static class Node {

        String name;
        int clockOffsetSeconds;

        Node(String name, int clockOffsetSeconds) {
            this.name = name;
            this.clockOffsetSeconds = clockOffsetSeconds;
        }

        LocalTime getCurrentTime() {

            return LocalTime.now()
                    .plusSeconds(clockOffsetSeconds);
        }

        void displayClock() {

            System.out.println(
                    name +
                    " | Clock: " +
                    getCurrentTime() +
                    " | Offset: " +
                    clockOffsetSeconds +
                    " seconds"
            );
        }
    }

    public static void main(String[] args) {

        System.out.println(
                "=================================================="
        );

        System.out.println(
                "     AUTONOMOUS ENTERPRISE KNOWLEDGE BASE"
        );

        System.out.println(
                "        CLOCK SYNCHRONIZATION EXPERIMENT"
        );

        System.out.println(
                "             BERKELEY ALGORITHM"
        );

        System.out.println(
                "=================================================="
        );

        // Simulated distributed computers
        Node node1 = new Node("Node 1", 20);
        Node node2 = new Node("Node 2", -15);
        Node node3 = new Node("Node 3", 30);
        Node node4 = new Node("Node 4", -10);

        Node[] nodes = {
                node1,
                node2,
                node3,
                node4
        };

        // ------------------------------------------
        // STEP 1: Display clocks before synchronization
        // ------------------------------------------

        System.out.println("\nCLOCKS BEFORE SYNCHRONIZATION");
        System.out.println("------------------------------------------");

        for (Node node : nodes) {
            node.displayClock();
        }

        // ------------------------------------------
        // STEP 2: Coordinator calculates average
        // ------------------------------------------

        int totalOffset = 0;

        for (Node node : nodes) {
            totalOffset += node.clockOffsetSeconds;
        }

        int averageOffset =
                totalOffset / nodes.length;

        System.out.println(
                "\nCoordinator calculated average offset: "
                + averageOffset +
                " seconds"
        );

        // ------------------------------------------
        // STEP 3: Calculate adjustments
        // ------------------------------------------

        System.out.println("\nCLOCK ADJUSTMENTS");
        System.out.println("------------------------------------------");

        for (Node node : nodes) {

            int adjustment =
                    averageOffset -
                    node.clockOffsetSeconds;

            System.out.println(
                    node.name +
                    " adjustment: " +
                    (adjustment >= 0 ? "+" : "") +
                    adjustment +
                    " seconds"
            );

            // Apply synchronization
            node.clockOffsetSeconds =
                    averageOffset;
        }

        // ------------------------------------------
        // STEP 4: Display clocks after synchronization
        // ------------------------------------------

        System.out.println(
                "\nCLOCKS AFTER SYNCHRONIZATION"
        );

        System.out.println(
                "------------------------------------------"
        );

        for (Node node : nodes) {
            node.displayClock();
        }

        System.out.println(
                "\nAll distributed nodes are synchronized."
        );

        System.out.println(
                "=================================================="
        );
    }
}