// TestDatabase.java
import java.sql.Connection;

public class TestDatabase {

    public static void main(String[] args) {
        // Using try-with-resources to ensure the connection auto-closes
        try (Connection con = DatabaseConnection.getConnection()) {
            
            if (con != null && !con.isClosed()) {
                System.out.println("MySQL connection successful!");
            }

        } catch (Exception e) {
            System.err.println("MySQL connection failed!");
            e.printStackTrace();
        }
    }
}