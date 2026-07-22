from datetime import date

from django.core.exceptions import ValidationError


def validate_asset_specs(category, specs):
    """Validate an asset's JSON specs against its category definition."""

    if specs in (None, ''):
        specs = {}
    if not isinstance(specs, dict):
        raise ValidationError({'specs': 'Specs must be a JSON object.'})

    schema = list(getattr(category, 'spec_schema', None) or [])
    allowed = {field.get('key') for field in schema if field.get('key')}
    unknown = sorted(set(specs) - allowed)
    if unknown:
        raise ValidationError({
            'specs': f"Unknown specification field(s): {', '.join(unknown)}."
        })

    errors = {}
    for field in schema:
        key = field.get('key')
        if not key:
            continue
        value = specs.get(key)
        empty = value is None or value == ''
        if field.get('required') and empty:
            errors[key] = 'This specification is required.'
            continue
        if empty:
            continue

        field_type = field.get('type')
        valid = True
        if field_type == 'text':
            valid = isinstance(value, str)
        elif field_type == 'number':
            valid = isinstance(value, (int, float)) and not isinstance(value, bool)
        elif field_type == 'bool':
            valid = isinstance(value, bool)
        elif field_type == 'date':
            valid = isinstance(value, str)
            if valid:
                try:
                    date.fromisoformat(value)
                except ValueError:
                    valid = False
        elif field_type == 'select':
            valid = value in (field.get('options') or [])

        if not valid:
            errors[key] = f"Invalid value for {field_type or 'unknown'} field."

    if errors:
        raise ValidationError({'specs': errors})
    return specs
