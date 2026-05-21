-- Add Eduardo as POS staff user for testing
-- PIN: 4567 (consultor access)
INSERT INTO pos_staff (name, pin, role, active, client_id)
VALUES ('Eduardo', '4567', 'consultor', true, 'amalay')
ON CONFLICT (pin, client_id) DO UPDATE SET name = 'Eduardo', role = 'consultor', active = true;
