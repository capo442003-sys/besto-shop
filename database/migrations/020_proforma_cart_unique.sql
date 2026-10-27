-- Une seule facture proforma par panier validé (évite doublons en concurrence).
DELETE FROM proforma_invoices a
USING proforma_invoices b
WHERE a.cart_id = b.cart_id AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS proforma_invoices_cart_id_key ON proforma_invoices (cart_id);
