"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Search, Plus, Eye, Clock, TrendingUp, AlertCircle, FileText } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuthStore } from "@/store/authStore";

export default function KBDashboardPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const [data, setData] = useState<any>(null);
  const [categories, setCategories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const canEdit = user?.role && ['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(user.role);

  useEffect(() => {
    Promise.all([
      api.get("/kb/dashboard/"),
      api.get("/kb/categories/")
    ]).then(([d, c]) => {
      setData(d.data);
      setCategories(c.data.results || c.data);
    }).catch(() => toast.error("Failed to load KB data"))
      .finally(() => setLoading(false));
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) router.push(`/kb/articles?search=${encodeURIComponent(search)}`);
  };

  if (loading) return <div className="p-8 text-center text-neutral-500">Loading Knowledge Base...</div>;
  if (!data) return <div className="p-8 text-center text-red-500">Failed to load Dashboard</div>;

  return (
    <div className="flex flex-col gap-8 w-full max-w-6xl mx-auto p-4">
      {/* Header & Search */}
      <div className="flex flex-col items-center text-center space-y-4 py-8 bg-violet-50 dark:bg-violet-900/10 rounded-2xl border border-violet-100 dark:border-violet-900/30">
        <BookOpen className="w-12 h-12 text-violet-500 mb-2" />
        <h1 className="text-3xl font-bold">How can we help?</h1>
        <p className="text-neutral-500 max-w-lg">Search our knowledge base for guides, policies, and troubleshooting steps.</p>
        <form onSubmit={handleSearch} className="w-full max-w-xl relative mt-4">
          <Search className="absolute left-4 top-3.5 h-5 w-5 text-neutral-400" />
          <Input 
            className="pl-12 h-12 text-lg rounded-full border-neutral-300 dark:border-neutral-700 shadow-sm" 
            placeholder="Search articles..." 
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <Button type="submit" className="absolute right-1.5 top-1.5 h-9 rounded-full bg-violet-600 hover:bg-violet-700">Search</Button>
        </form>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 gap-4 -mt-2">
        <Card className="p-4 flex flex-col items-center text-center">
          <span className="text-2xl font-bold">{data.total_articles ?? 0}</span>
          <span className="text-xs text-neutral-500 mt-0.5">Published articles</span>
        </Card>
        <Card className="p-4 flex flex-col items-center text-center">
          <span className="text-2xl font-bold">{data.total_categories ?? 0}</span>
          <span className="text-xs text-neutral-500 mt-0.5">Categories</span>
        </Card>
        <Card className="p-4 flex flex-col items-center text-center">
          <span className="text-2xl font-bold flex items-center gap-1.5"><Eye className="w-5 h-5 text-neutral-400" />{data.total_views ?? 0}</span>
          <span className="text-xs text-neutral-500 mt-0.5">Total views</span>
        </Card>
      </div>

      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Categories</h2>
        {canEdit && (
          <Button onClick={() => router.push("/kb/articles/new")} className="bg-violet-600 hover:bg-violet-700">
            <Plus className="w-4 h-4 mr-2" /> New Article
          </Button>
        )}
      </div>

      {/* Category Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {categories.map(cat => (
          <Card 
            key={cat.id} 
            className="p-4 cursor-pointer hover:border-violet-300 transition-all hover:shadow-md flex flex-col items-center text-center group"
            onClick={() => router.push(`/kb/articles?category=${cat.slug}`)}
          >
            <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
              {/* Fallback to BookOpen if dynamic icon mapping is complex */}
              <FileText className="w-6 h-6 text-violet-600" />
            </div>
            <h3 className="font-medium text-neutral-800 dark:text-neutral-200">{cat.name}</h3>
            <span className="text-xs text-neutral-500 mt-1">{cat.article_count} articles</span>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Most Viewed */}
        <Card className="p-5">
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><TrendingUp className="w-5 h-5 text-emerald-500"/>Most Viewed Articles</h3>
          {data.most_viewed_articles?.length === 0 ? <p className="text-sm text-neutral-500">No articles yet.</p> : 
            <div className="space-y-3">
              {data.most_viewed_articles.map((art: any) => (
                <div key={art.id} className="flex justify-between items-start gap-4 p-2 -mx-2 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer" onClick={() => router.push(`/kb/articles/${art.slug}`)}>
                  <div>
                    <h4 className="font-medium text-violet-700 dark:text-violet-400 hover:underline">{art.title}</h4>
                    <div className="text-xs text-neutral-500 mt-0.5 flex gap-2">
                      <span>{art.category_name}</span>
                      {art.visibility !== 'ALL_STAFF' && <Badge variant="outline" className="text-[9px] py-0 h-4">{art.visibility}</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 text-xs text-neutral-400 whitespace-nowrap"><Eye className="w-3 h-3"/> {art.view_count}</div>
                </div>
              ))}
            </div>
          }
        </Card>

        {/* Recently Updated */}
        <Card className="p-5">
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2"><Clock className="w-5 h-5 text-blue-500"/>Recently Updated</h3>
          {data.recently_updated?.length === 0 ? <p className="text-sm text-neutral-500">No articles yet.</p> : 
            <div className="space-y-3">
              {data.recently_updated.map((art: any) => (
                <div key={art.id} className="flex justify-between items-start gap-4 p-2 -mx-2 rounded hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer" onClick={() => router.push(`/kb/articles/${art.slug}`)}>
                  <div>
                    <h4 className="font-medium text-violet-700 dark:text-violet-400 hover:underline">{art.title}</h4>
                    <div className="text-xs text-neutral-500 mt-0.5">By {art.author_name}</div>
                  </div>
                  <div className="text-xs text-neutral-400 whitespace-nowrap">{new Date(art.updated_at).toLocaleDateString()}</div>
                </div>
              ))}
            </div>
          }
        </Card>
      </div>

      {/* Needs Review (Manager+) */}
      {canEdit && data.articles_needing_review?.length > 0 && (
        <Card className="p-5 border-orange-200 bg-orange-50/50 dark:bg-orange-900/10">
          <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-orange-700"><AlertCircle className="w-5 h-5"/>Stale Articles Needing Review</h3>
          <div className="space-y-2">
            {data.articles_needing_review.map((art: any) => (
              <div key={art.id} className="flex justify-between items-center bg-white dark:bg-neutral-800 p-2 rounded border border-orange-100 dark:border-orange-900/30">
                <div><span className="font-medium text-sm">{art.title}</span> <span className="text-xs text-neutral-500 ml-2">Last updated {new Date(art.updated_at).toLocaleDateString()}</span></div>
                <Button size="sm" variant="outline" onClick={() => router.push(`/kb/articles/${art.slug}/edit`)}>Review</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

    </div>
  );
}
