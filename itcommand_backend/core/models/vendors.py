from django.db import models
from django.conf import settings
from django.utils import timezone
import datetime

class VendorCategory(models.TextChoices):
    HARDWARE_SUPPLIER = 'HARDWARE_SUPPLIER', 'Hardware Supplier'
    SOFTWARE_VENDOR = 'SOFTWARE_VENDOR', 'Software Vendor'
    SERVICE_PROVIDER = 'SERVICE_PROVIDER', 'Service Provider'
    TELECOM = 'TELECOM', 'Telecom'
    CLOUD = 'CLOUD', 'Cloud Provider'
    MAINTENANCE = 'MAINTENANCE', 'Maintenance'
    CONSULTANT = 'CONSULTANT', 'Consultant'
    OTHER = 'OTHER', 'Other'

class ContractType(models.TextChoices):
    AMC = 'AMC', 'Annual Maintenance Contract'
    SLA = 'SLA', 'Service Level Agreement'
    PURCHASE = 'PURCHASE', 'Purchase Agreement'
    SERVICE = 'SERVICE', 'Service Agreement'
    LICENSE = 'LICENSE', 'Software License'
    NDA = 'NDA', 'Non-Disclosure Agreement'
    OTHER = 'OTHER', 'Other'

class ContractStatus(models.TextChoices):
    DRAFT = 'DRAFT', 'Draft'
    ACTIVE = 'ACTIVE', 'Active'
    EXPIRED = 'EXPIRED', 'Expired'
    TERMINATED = 'TERMINATED', 'Terminated'
    RENEWED = 'RENEWED', 'Renewed'

class PaymentMethod(models.TextChoices):
    BANK_TRANSFER = 'BANK_TRANSFER', 'Bank Transfer'
    CHEQUE = 'CHEQUE', 'Cheque'
    CARD = 'CARD', 'Credit/Debit Card'
    CASH = 'CASH', 'Cash'


class Vendor(models.Model):
    name = models.CharField(max_length=255)
    vendor_code = models.CharField(max_length=50, unique=True, blank=True)
    category = models.CharField(max_length=50, choices=VendorCategory.choices, default=VendorCategory.OTHER)
    
    website = models.URLField(max_length=200, blank=True, null=True)
    email = models.EmailField(blank=True, null=True)
    phone = models.CharField(max_length=50, blank=True, null=True)
    
    address = models.TextField(blank=True, null=True)
    city = models.CharField(max_length=100, blank=True, null=True)
    country = models.CharField(max_length=100, blank=True, null=True)
    
    primary_contact_name = models.CharField(max_length=150, blank=True, null=True)
    primary_contact_email = models.EmailField(blank=True, null=True)
    primary_contact_phone = models.CharField(max_length=50, blank=True, null=True)
    
    tax_number = models.CharField(max_length=100, blank=True, null=True)
    rating = models.PositiveSmallIntegerField(null=True, blank=True, choices=[(i, i) for i in range(1, 6)])
    
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, null=True)
    
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.vendor_code:
            # Simple auto-generation. Better approach would use a sequence.
            last_vendor = Vendor.objects.order_by('-id').first()
            if last_vendor and last_vendor.vendor_code.startswith('VND-'):
                try:
                    last_num = int(last_vendor.vendor_code.split('-')[1])
                    self.vendor_code = f"VND-{last_num + 1:03d}"
                except ValueError:
                    self.vendor_code = f"VND-{Vendor.objects.count() + 1:03d}"
            else:
                self.vendor_code = f"VND-{Vendor.objects.count() + 1:03d}"
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.name} ({self.vendor_code})"


class VendorContract(models.Model):
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name='contracts')
    contract_number = models.CharField(max_length=100, unique=True, blank=True)
    title = models.CharField(max_length=255)
    contract_type = models.CharField(max_length=50, choices=ContractType.choices, default=ContractType.OTHER)
    
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    
    value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    currency = models.CharField(max_length=10, default='PKR')
    payment_terms = models.CharField(max_length=255, blank=True, null=True)
    
    auto_renew = models.BooleanField(default=False)
    status = models.CharField(max_length=50, choices=ContractStatus.choices, default=ContractStatus.DRAFT)
    
    description = models.TextField(blank=True, null=True)
    terms_summary = models.TextField(blank=True, null=True)
    document = models.FileField(upload_to='contracts/', blank=True, null=True)
    
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        if not self.contract_number:
            last_contract = VendorContract.objects.order_by('-id').first()
            if last_contract and last_contract.contract_number.startswith('CTR-'):
                try:
                    last_num = int(last_contract.contract_number.split('-')[1])
                    self.contract_number = f"CTR-{last_num + 1:03d}"
                except ValueError:
                    self.contract_number = f"CTR-{VendorContract.objects.count() + 1:03d}"
            else:
                self.contract_number = f"CTR-{VendorContract.objects.count() + 1:03d}"
        
        # Auto-update status to EXPIRED if end_date has passed
        if self.end_date and self.status == ContractStatus.ACTIVE:
            if self.end_date < datetime.date.today():
                self.status = ContractStatus.EXPIRED

        super().save(*args, **kwargs)

    def __str__(self):
        return self.title


class VendorPayment(models.Model):
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name='payments')
    contract = models.ForeignKey(VendorContract, on_delete=models.SET_NULL, null=True, blank=True, related_name='payments')
    
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_date = models.DateField()
    payment_method = models.CharField(max_length=50, choices=PaymentMethod.choices, default=PaymentMethod.BANK_TRANSFER)
    
    reference_number = models.CharField(max_length=100, blank=True, null=True)
    invoice_number = models.CharField(max_length=100, blank=True, null=True)
    description = models.TextField(blank=True, null=True)
    
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.amount} to {self.vendor.name} on {self.payment_date}"


class VendorNote(models.Model):
    vendor = models.ForeignKey(Vendor, on_delete=models.CASCADE, related_name='timeline_notes')
    note = models.TextField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"Note on {self.vendor.name} at {self.created_at}"
