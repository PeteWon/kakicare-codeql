from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('audit', '0001_initial'),
    ]

    operations = [
        migrations.RunSQL(
            sql="""
                CREATE OR REPLACE FUNCTION audit_log_block_mutate()
                RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    RAISE EXCEPTION 'audit_auditlogentry is append-only: UPDATE and DELETE are not permitted';
                END;
                $$;

                CREATE TRIGGER audit_log_no_update
                    BEFORE UPDATE ON audit_auditlogentry
                    FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutate();

                CREATE TRIGGER audit_log_no_delete
                    BEFORE DELETE ON audit_auditlogentry
                    FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutate();
            """,
            reverse_sql="""
                DROP TRIGGER IF EXISTS audit_log_no_update ON audit_auditlogentry;
                DROP TRIGGER IF EXISTS audit_log_no_delete ON audit_auditlogentry;
                DROP FUNCTION IF EXISTS audit_log_block_mutate();
            """,
        ),
    ]
