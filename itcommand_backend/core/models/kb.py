from django.db import models
from django.conf import settings
from django.utils.text import slugify
from simple_history.models import HistoricalRecords
from .assets import Asset
from .helpdesk import TicketCategory
import re
import html


class KBTag(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=120, unique=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['name']


class KBCategory(models.Model):
    name = models.CharField(max_length=200)
    slug = models.SlugField(max_length=220, unique=True, blank=True)
    description = models.TextField(blank=True, null=True)
    parent = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='children')
    icon_name = models.CharField(max_length=50, blank=True, null=True)
    order = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

    class Meta:
        ordering = ['order', 'name']
        verbose_name_plural = 'KB Categories'


class ArticleStatus(models.TextChoices):
    DRAFT = 'DRAFT', 'Draft'
    PUBLISHED = 'PUBLISHED', 'Published'
    ARCHIVED = 'ARCHIVED', 'Archived'


class ArticleVisibility(models.TextChoices):
    ALL_STAFF = 'ALL_STAFF', 'All Staff'
    IT_ONLY = 'IT_ONLY', 'IT Only'
    ADMIN_ONLY = 'ADMIN_ONLY', 'Admin Only'


class KBArticle(models.Model):
    title = models.CharField(max_length=500)
    slug = models.SlugField(max_length=520, unique=True, blank=True)
    category = models.ForeignKey(KBCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='articles')
    content = models.TextField(blank=True, null=True)
    excerpt = models.TextField(blank=True, null=True)
    tags = models.ManyToManyField(KBTag, blank=True, related_name='articles')
    status = models.CharField(max_length=20, choices=ArticleStatus.choices, default=ArticleStatus.DRAFT)
    visibility = models.CharField(max_length=20, choices=ArticleVisibility.choices, default=ArticleVisibility.ALL_STAFF)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='kb_authored')
    last_edited_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='kb_edited')
    view_count = models.PositiveIntegerField(default=0)
    is_pinned = models.BooleanField(default=False)
    linked_assets = models.ManyToManyField(Asset, blank=True, related_name='kb_articles')
    linked_tickets_category = models.ForeignKey(
        TicketCategory, on_delete=models.SET_NULL, null=True, blank=True, related_name='kb_articles'
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    history = HistoricalRecords()

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.title)
            slug = base
            n = 1
            while KBArticle.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f"{base}-{n}"
                n += 1
            self.slug = slug
        # Auto-generate excerpt: strip tags, decode entities, collapse whitespace.
        if self.content:
            plain = re.sub(r'<[^>]+>', ' ', self.content)
            plain = html.unescape(plain)
            plain = re.sub(r'\s+', ' ', plain).strip()
            self.excerpt = plain[:200].strip()
        else:
            self.excerpt = ''
        super().save(*args, **kwargs)

    def __str__(self):
        return self.title

    class Meta:
        ordering = ['-updated_at']


class KBFeedback(models.Model):
    article = models.ForeignKey(KBArticle, on_delete=models.CASCADE, related_name='feedbacks')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    is_helpful = models.BooleanField()
    comment = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['article', 'user']
        ordering = ['-created_at']

    def __str__(self):
        return f"{'👍' if self.is_helpful else '👎'} on {self.article.title}"
