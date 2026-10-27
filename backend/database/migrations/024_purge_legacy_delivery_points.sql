-- Supprime les anciens dépôts et points de vente Konkola (DEP01-03, PV01-09)
DO $$
DECLARE
  legacy_codes TEXT[] := ARRAY[
    'DEP01', 'DEP02', 'DEP03',
    'PV01', 'PV02', 'PV03', 'PV04', 'PV05', 'PV06', 'PV07', 'PV08', 'PV09'
  ];
  dp_ids INTEGER[];
  has_supply_depot BOOLEAN;
BEGIN
  SELECT ARRAY_AGG(id) INTO dp_ids
  FROM delivery_points
  WHERE UPPER(code) = ANY(legacy_codes);

  IF dp_ids IS NULL OR array_length(dp_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'delivery_points'
      AND column_name = 'supply_depot_id'
  ) INTO has_supply_depot;

  IF has_supply_depot THEN
    UPDATE delivery_points
    SET supply_depot_id = NULL
    WHERE supply_depot_id = ANY(dp_ids);
  END IF;

  UPDATE employees SET delivery_point_id = NULL WHERE delivery_point_id = ANY(dp_ids);
  UPDATE sales_carts SET delivery_point_id = NULL WHERE delivery_point_id = ANY(dp_ids);
  DELETE FROM product_stock WHERE delivery_point_id = ANY(dp_ids);
  UPDATE stock_movements SET delivery_point_id = NULL WHERE delivery_point_id = ANY(dp_ids);
  DELETE FROM delivery_points WHERE id = ANY(dp_ids);
END $$;
