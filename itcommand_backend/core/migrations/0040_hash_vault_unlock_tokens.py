import hashlib

from django.db import migrations


def hash_existing_tokens(apps, schema_editor):
    VaultUnlockSession = apps.get_model('core', 'VaultUnlockSession')
    for session in VaultUnlockSession.objects.all().iterator():
        session.token = hashlib.sha256(session.token.encode('utf-8')).hexdigest()
        session.save(update_fields=['token'])


class Migration(migrations.Migration):
    dependencies = [('core', '0039_networkdevicestatuslog')]

    operations = [migrations.RunPython(hash_existing_tokens, migrations.RunPython.noop)]
