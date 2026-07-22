from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('core', '0040_hash_vault_unlock_tokens')]

    operations = [
        migrations.AddField(
            model_name='asset',
            name='source_purchase_request_item',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='created_asset',
                to='core.purchaserequestitem',
            ),
        ),
    ]
