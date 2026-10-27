-- Avances client : versements anticipés pour achats futurs
DO $$ BEGIN
  ALTER TYPE settlement_type ADD VALUE 'avance_client';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
