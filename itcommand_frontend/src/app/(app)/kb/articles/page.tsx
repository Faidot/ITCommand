"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, Eye, ThumbsUp } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuthStore } from "@/store/authStore";

export default function KBArticlesPage() {
  const router = useRouter();
  const sp = useSearchParams();
  const { user } = useAuthStore();
  
  const [articles, setArticles] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [search, setSearch] = useState(sp.get("search") || "");
  const [category, setCategory] = useState(sp.get("category") || "ALL");
  const [visibility, setVisibility] = useState("ALL");

  const canEdit = user?.role && ['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(user.role);

  useEffect(() => {
    api.get("/kb/categories/").then(r => setCategories(r.data.results || r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = setTimeout(fetchArticles, 300);
    return () => clearTimeout(handler);
  }, [search, category, visibility]);

  const fetchArticles = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      if (search) p.append("search", search);
      if (category !== "ALL") p.append("category", category);
      if (visibility !== "ALL") p.append("visibility", visibility);
      const r = await api.get(`/kb/articles/?${p}`);
      setArticles(r.data.results || r.data);
    } catch {
      toast.error("Failed to fetch articles");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-6xl mx-auto p-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold">All Articles</h1>
          <p className="text-neutral-500">Browse the entire knowledge base.</p>
        </div>
        {canEdit && (
          <Button onClick={() => router.push("/kb/articles/new")} className="bg-violet-600 hover:bg-violet-700">
            <Plus className="mr-2 h-4 w-4" /> New Article
          </Button>
        )}
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-neutral-500" />
          <Input placeholder="Search titles, content, tags..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[200px]"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Categories</SelectItem>
            {categories.map(c => <SelectItem key={c.id} value={c.slug}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {canEdit && (
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger className="w-[150px]"><SelectValue placeholder="Visibility" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Visibility</SelectItem>
              <SelectItem value="ALL_STAFF">All Staff</SelectItem>
              <SelectItem value="IT_ONLY">IT Only</SelectItem>
              <SelectItem value="ADMIN_ONLY">Admin Only</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>

      {loading ? (
        <div className="p-10 text-center text-neutral-500">Searching...</div>
      ) : articles.length === 0 ? (
        <Card className="p-10 text-center text-neutral-500">
          <p>No articles found matching your criteria.</p>
          <Button variant="link" onClick={() => { setSearch(""); setCategory("ALL"); setVisibility("ALL"); }}>Clear filters</Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {articles.map((art: any) => (
            <Card key={art.id} className="p-5 hover:border-violet-300 transition-colors cursor-pointer" onClick={() => router.push(`/kb/articles/${art.slug}`)}>
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="secondary" className="text-[10px] bg-neutral-100 text-neutral-600 hover:bg-neutral-200">{art.category_name}</Badge>
                    {art.status === 'DRAFT' && <Badge variant="outline" className="text-[10px] border-yellow-200 text-yellow-700 bg-yellow-50">DRAFT</Badge>}
                    {art.visibility === 'IT_ONLY' && <Badge variant="outline" className="text-[10px] border-blue-200 text-blue-700 bg-blue-50">IT ONLY</Badge>}
                    {art.visibility === 'ADMIN_ONLY' && <Badge variant="outline" className="text-[10px] border-red-200 text-red-700 bg-red-50">ADMIN ONLY</Badge>}
                  </div>
                  <h3 className="text-lg font-semibold text-violet-700 dark:text-violet-400 mb-2">{art.title}</h3>
                  <p className="text-sm text-neutral-600 dark:text-neutral-300 line-clamp-2 mb-3">{art.excerpt}</p>
                  
                  <div className="flex flex-wrap gap-2 mb-3">
                    {art.tags?.map((t: any) => (
                      <Badge key={t.id} variant="outline" className="text-[10px] text-neutral-500">#{t.name}</Badge>
                    ))}
                  </div>

                  <div className="flex items-center gap-4 text-xs text-neutral-500">
                    <span>By {art.author_name}</span>
                    <span>Updated {new Date(art.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
                
                <div className="flex flex-col items-end gap-2 text-xs text-neutral-400 shrink-0">
                  <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {art.view_count}</span>
                  {art.feedback_summary?.total > 0 && (
                    <span className="flex items-center gap-1 text-emerald-600"><ThumbsUp className="w-3.5 h-3.5" /> {Math.round((art.feedback_summary.helpful / art.feedback_summary.total)*100)}%</span>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
