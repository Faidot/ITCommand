from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.test import TestCase
from django.urls import reverse
from io import StringIO
from rest_framework import status
from rest_framework.test import APIClient

from core.lov import GROUPS, get_choices, get_values, is_valid
from core.models import ListOfValues
from core.test_subscriptions import create_role, create_user


class ListOfValuesModelTests(TestCase):
    def setUp(self):
        call_command('seed_lovs', stdout=StringIO())

    def test_seeding_is_idempotent(self):
        before = ListOfValues.objects.count()
        call_command('seed_lovs', stdout=StringIO())
        self.assertEqual(ListOfValues.objects.count(), before)

    def test_extendable_groups_accept_new_values(self):
        value = ListOfValues(group='currency', code='chf', label='Swiss Franc')
        value.full_clean()
        value.save()
        self.assertEqual(value.code, 'CHF', 'codes should be normalised to uppercase')
        self.assertTrue(is_valid('currency', 'CHF'))
        self.assertTrue(is_valid('currency', 'chf'), 'lookup should be case-insensitive')

    def test_system_groups_reject_new_values(self):
        value = ListOfValues(
            group='subscription_status', code='SUSPENDED', label='Suspended'
        )
        with self.assertRaises(ValidationError) as ctx:
            value.full_clean()
        self.assertIn('code', ctx.exception.message_dict)

    def test_a_system_code_cannot_be_renamed(self):
        value = ListOfValues.objects.get(group='subscription_status', code='ACTIVE')
        self.assertTrue(value.is_system)
        value.code = 'LIVE'
        with self.assertRaises(ValidationError):
            value.full_clean()

    def test_a_system_label_can_be_changed(self):
        value = ListOfValues.objects.get(group='subscription_status', code='CANCELLED')
        value.label = 'Terminated'
        value.full_clean()
        value.save()
        labels = dict(get_choices('subscription_status'))
        self.assertEqual(labels['CANCELLED'], 'Terminated')

    def test_hiding_a_value_removes_it_from_choices(self):
        value = ListOfValues.objects.get(group='currency', code='JPY')
        value.is_active = False
        value.save()
        self.assertNotIn('JPY', dict(get_choices('currency')))
        self.assertIn('JPY', dict(get_choices('currency', active_only=False)))

    def test_unknown_group_is_rejected(self):
        value = ListOfValues(group='not_a_group', code='X', label='X')
        with self.assertRaises(ValidationError) as ctx:
            value.full_clean()
        self.assertIn('group', ctx.exception.message_dict)

    def test_currency_codes_must_be_three_letters(self):
        for bad in ('US', 'DOLLAR', 'U5D'):
            with self.assertRaises(ValidationError, msg=bad):
                ListOfValues(group='currency', code=bad, label='x').full_clean()

    def test_a_non_iso_currency_is_rejected(self):
        """Admin must not be able to add a code the serializer would reject."""
        with self.assertRaises(ValidationError):
            ListOfValues(group='currency', code='XYZ', label='Fake money').full_clean()

    def test_duplicate_codes_within_a_group_are_rejected(self):
        value = ListOfValues(group='currency', code='USD', label='Dollar again')
        with self.assertRaises(ValidationError):
            value.full_clean()

    def test_empty_group_falls_back_to_builtin_choices(self):
        ListOfValues.objects.filter(group='vault_category').delete()
        values = get_values('vault_category')
        self.assertTrue(values, 'a dropdown must never be empty')

    def test_currency_falls_back_when_nothing_is_seeded(self):
        """A fresh install must still offer currencies, or Settings is unusable."""
        ListOfValues.objects.filter(group='currency').delete()
        codes = {code for code, _ in get_values('currency')}
        self.assertIn('USD', codes)
        self.assertIn('PKR', codes)

    def test_every_registered_group_seeds_something(self):
        for key in GROUPS:
            self.assertTrue(get_values(key), f'group {key} produced no values')


class ListOfValuesApiTests(TestCase):
    def setUp(self):
        call_command('seed_lovs', stdout=StringIO())
        self.client = APIClient()
        self.user = create_user('lov@example.com', create_role('LOV_VIEWER', view=True).slug)
        self.client.force_authenticate(self.user)

    def test_single_group_lookup(self):
        response = self.client.get(reverse('list_of_values'), {'group': 'currency'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['group'], 'currency')
        codes = {row['value'] for row in response.data['values']}
        self.assertIn('USD', codes)
        self.assertIn('PKR', codes)

    def test_all_groups(self):
        response = self.client.get(reverse('list_of_values'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(set(response.data), set(GROUPS))

    def test_unknown_group_is_a_400(self):
        response = self.client.get(reverse('list_of_values'), {'group': 'nope'})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_anonymous_access_is_denied(self):
        self.client.force_authenticate(None)
        response = self.client.get(reverse('list_of_values'))
        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_a_currency_added_in_admin_reaches_the_api(self):
        ListOfValues.objects.create(
            group='currency', code='NOK', label='Norwegian Krone', sort_order=99
        )
        response = self.client.get(reverse('list_of_values'), {'group': 'currency'})
        codes = {row['value'] for row in response.data['values']}
        self.assertIn('NOK', codes)
