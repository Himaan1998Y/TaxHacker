-- Enable pgvector extension (available in postgres:17-alpine)
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column to transactions table
-- Using 768 dimensions (compatible with Gemini, Nomic, BGE, most models)
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- Create HNSW index for fast approximate nearest neighbor search
-- cosine distance is best for semantic similarity
CREATE INDEX IF NOT EXISTS "transactions_embedding_idx"
  ON "transactions"
  USING hnsw ("embedding" vector_cosine_ops);
