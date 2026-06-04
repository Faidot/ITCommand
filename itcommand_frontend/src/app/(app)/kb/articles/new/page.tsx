"use client";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Save, CheckCircle2 } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuthStore } from "@/store/authStore";

// Tiptap imports
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';

const lowlight = createLowlight(common);

export default function KBArticleEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const isEdit = !!params.slug;
  const slug = params.slug as string;

  const canEdit = !!user?.role && ["MANAGER", "ADMIN", "SUPERADMIN"].includes(user.role);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [categories, setCategories] = useState<any[]>([]);

  const [form, setForm] = useState({
    title: "",
    category: "",
    status: "DRAFT",
    visibility: "ALL_STAFF",
    is_pinned: false,
  });
  const [tagsInput, setTagsInput] = useState("");

  // Block non-editors from the editor (the API also enforces this).
  useEffect(() => {
    if (user && !canEdit) {
      toast.error("You don't have permission to edit articles.");
      router.replace("/kb");
    }
  }, [user, canEdit, router]);

  const editor = useEditor({
    // Next.js App Router renders this on the server first; Tiptap must defer its
    // first render to the client to avoid a hydration mismatch.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      CodeBlockLowlight.configure({ lowlight }),
    ],
    content: '',
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none min-h-[500px] p-4',
      },
    },
  });

  useEffect(() => {
    api.get("/kb/categories/").then(r => setCategories(r.data.results || r.data)).catch(() => {});
    
    if (isEdit) {
      api.get(`/kb/articles/${slug}/`).then(r => {
        const d = r.data;
        setForm({
          title: d.title,
          category: String(d.category || ""),
          status: d.status,
          visibility: d.visibility,
          is_pinned: d.is_pinned,
        });
        setTagsInput((d.tags || []).map((t: any) => t.name).join(", "));
        if (editor) editor.commands.setContent(d.content || "");
      }).catch(() => toast.error("Failed to load article")).finally(() => setLoading(false));
    }
  }, [slug, isEdit, editor]);

  // Resolve a comma-separated tag string into KBTag ids, creating any that
  // don't exist yet. Only called on manual saves to keep auto-save lightweight.
  const resolveTagIds = async (raw: string): Promise<number[]> => {
    const names = Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
    const ids: number[] = [];
    for (const name of names) {
      try {
        const r = await api.get(`/kb/tags/?search=${encodeURIComponent(name)}`);
        const list = r.data.results || r.data;
        const existing = list.find((t: any) => t.name.toLowerCase() === name.toLowerCase());
        if (existing) { ids.push(existing.id); continue; }
        const created = await api.post("/kb/tags/", { name });
        ids.push(created.data.id);
      } catch { /* skip a tag that fails to resolve */ }
    }
    return ids;
  };

  const handleSave = async (publish: boolean, isAutoSave = false) => {
    if (!form.title.trim()) { if(!isAutoSave) toast.error("Title is required"); return; }
    if (!form.category) { if(!isAutoSave) toast.error("Category is required"); return; }

    if(!isAutoSave) setSaving(true);
    const content = editor?.getHTML();

    const payload: any = {
      ...form,
      category: parseInt(form.category),
      content,
      status: publish ? "PUBLISHED" : form.status,
    };
    // Tags only on manual saves; omitting tag_ids leaves existing tags untouched.
    if (!isAutoSave) {
      payload.tag_ids = await resolveTagIds(tagsInput);
    }

    try {
      if (isEdit) {
        await api.put(`/kb/articles/${slug}/`, payload);
        if(!isAutoSave) {
            toast.success("Article updated");
            router.push(`/kb/articles/${slug}`);
        } else {
            setLastSaved(new Date());
        }
      } else {
        const r = await api.post("/kb/articles/", payload);
        if(!isAutoSave) {
            toast.success("Article created");
            router.push(`/kb/articles/${r.data.slug}`);
        } else {
            // If auto-saved on new, redirect to edit silently
            router.replace(`/kb/articles/${r.data.slug}/edit`);
            setLastSaved(new Date());
        }
      }
    } catch (e: any) {
      if(!isAutoSave) {
          const d = e.response?.data;
          if (d && typeof d === 'object') {
            toast.error(Object.entries(d).map(([k, v]) => `${k}: ${v}`).join(' | '));
          } else {
            toast.error("Failed to save article");
          }
      }
    } finally {
      if(!isAutoSave) setSaving(false);
    }
  };

  // Keep a ref to the latest save fn so the auto-save timer is created once and
  // doesn't reset on every keystroke (which previously meant it rarely fired).
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;
  useEffect(() => {
    const interval = setInterval(() => { saveRef.current(false, true); }, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="p-10 text-center">Loading editor...</div>;

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] overflow-hidden">
      {/* Topbar */}
      <div className="flex items-center justify-between p-4 border-b bg-white dark:bg-neutral-950 shrink-0">
        <div className="flex items-center gap-4 flex-1">
          <Button variant="ghost" size="icon" onClick={() => router.back()}><ArrowLeft className="w-5 h-5"/></Button>
          <Input 
            value={form.title} 
            onChange={e => setForm({...form, title: e.target.value})} 
            placeholder="Article Title..." 
            className="text-lg font-bold border-0 bg-transparent focus-visible:ring-0 shadow-none px-0 max-w-xl"
          />
        </div>
        <div className="flex items-center gap-4">
          {lastSaved && <span className="text-xs text-neutral-400">Saved {lastSaved.toLocaleTimeString()}</span>}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
              <Save className="w-4 h-4 mr-2" /> Save Draft
            </Button>
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => handleSave(true)} disabled={saving}>
              <CheckCircle2 className="w-4 h-4 mr-2" /> Publish
            </Button>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Editor Area */}
        <div className="flex-1 overflow-y-auto bg-neutral-50 dark:bg-neutral-900 flex flex-col">
          {/* Toolbar */}
          {editor && (
            <div className="sticky top-0 z-10 flex flex-wrap gap-1 p-2 bg-white dark:bg-neutral-950 border-b">
              <Button size="sm" variant={editor.isActive('heading', { level: 1 }) ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</Button>
              <Button size="sm" variant={editor.isActive('heading', { level: 2 }) ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</Button>
              <Button size="sm" variant={editor.isActive('heading', { level: 3 }) ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</Button>
              <div className="w-px h-6 bg-neutral-300 dark:bg-neutral-700 mx-1 self-center" />
              <Button size="sm" variant={editor.isActive('bold') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></Button>
              <Button size="sm" variant={editor.isActive('italic') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></Button>
              <Button size="sm" variant={editor.isActive('strike') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleStrike().run()}><del>S</del></Button>
              <div className="w-px h-6 bg-neutral-300 dark:bg-neutral-700 mx-1 self-center" />
              <Button size="sm" variant={editor.isActive('bulletList') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</Button>
              <Button size="sm" variant={editor.isActive('orderedList') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</Button>
              <Button size="sm" variant={editor.isActive('blockquote') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Quote</Button>
              <div className="w-px h-6 bg-neutral-300 dark:bg-neutral-700 mx-1 self-center" />
              <Button size="sm" variant={editor.isActive('codeBlock') ? 'secondary' : 'ghost'} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>{'<Code/>'}</Button>
              <Button size="sm" variant="ghost" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>Table</Button>
            </div>
          )}
          
          <div className="flex-1 p-4 md:p-8 cursor-text">
            <EditorContent editor={editor} className="bg-white dark:bg-neutral-950 min-h-full rounded-xl border shadow-sm" />
          </div>
        </div>

        {/* Settings Sidebar */}
        <div className="w-80 border-l bg-white dark:bg-neutral-950 p-4 overflow-y-auto shrink-0 flex flex-col gap-6">
          <div className="space-y-2">
            <Label>Category *</Label>
            <Select value={form.category} onValueChange={v => setForm({...form, category: v})}>
              <SelectTrigger><SelectValue placeholder="Select Category..." /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <Input
              value={tagsInput}
              onChange={(e) => setTagsInput(e.target.value)}
              placeholder="e.g. vpn, remote, setup"
            />
            <p className="text-xs text-neutral-500">Comma-separated. New tags are created automatically on save.</p>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="PUBLISHED">Published</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <Select value={form.visibility} onValueChange={v => setForm({...form, visibility: v})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL_STAFF">All Staff (Everyone)</SelectItem>
                <SelectItem value="IT_ONLY">IT Staff Only</SelectItem>
                <SelectItem value="ADMIN_ONLY">Admins Only</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-neutral-500 mt-1">Who can view this article?</p>
          </div>

          <div className="flex items-center justify-between border-t pt-6">
            <Label htmlFor="pin-article" className="flex flex-col gap-1">
              <span>Pin Article</span>
              <span className="text-xs text-neutral-500 font-normal">Feature on KB homepage</span>
            </Label>
            <Switch id="pin-article" checked={form.is_pinned} onCheckedChange={c => setForm({...form, is_pinned: c})} />
          </div>
        </div>
      </div>
    </div>
  );
}
