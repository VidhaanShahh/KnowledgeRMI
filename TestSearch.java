public class TestSearch {
    public static void main(String[] args) {
        VectorSearch searcher = new VectorSearch();
        searcher.addChunk(1, 1, "The quick Brown FOX jumps over the LAZY dog.");
        searcher.buildIndex();
        
        System.out.println("Query 'fox':");
        for (VectorSearch.SearchResult res : searcher.search("fox", 10)) {
            System.out.println(res);
        }
        
        System.out.println("\nQuery 'FOX':");
        for (VectorSearch.SearchResult res : searcher.search("FOX", 10)) {
            System.out.println(res);
        }
        
        System.out.println("\nQuery 'bRoWn FoX':");
        for (VectorSearch.SearchResult res : searcher.search("bRoWn FoX", 10)) {
            System.out.println(res);
        }
    }
}
