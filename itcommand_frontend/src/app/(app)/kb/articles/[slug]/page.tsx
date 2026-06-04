"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Eye, Clock, Edit, ThumbsUp, ThumbsDown, History, FileText, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAuthStore } from "@/store/authStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function KBArticleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const slug = params.slug as string;

  const [article, setArticle] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [showFeedbackBox, setShowFeedbackBox] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<any[]>([]);
  const [related, setRelated] = useState<any[]>([]);

  const canEdit = user?.role && ['MANAGER', 'ADMIN', 'SUPERADMIN'].includes(user.role);

  useEffect(() => {
    setLoading(true);
    api.get(`/kb/articles/${slug}/`).then(r => {
      setArticle(r.data);
      if (r.data.user_feedback) setFeedback(r.data.user_feedback.is_helpful);
    }).catch(() => toast.error("Article not found")).finally(() => setLoading(false));
    api.get(`/kb/articles/${slug}/related/`).then(r => setRelated(r.data || [])).catch(() => setRelated([]));
  }, [slug]);

  const submitFeedback = async (isHelpful: boolean) => {
    try {
      await api.post(`/kb/articles/${slug}/feedback/`, { is_helpful: isHelpful, comment });
      setFeedback(isHelpful);
      if (!showFeedbackBox) {
        setShowFeedbackBox(true);
        toast.success("Thanks for your feedback!");
      } else {
        toast.success("Feedback updated");
        setShowFeedbackBox(false);
      }
      // Refresh
      const r = await api.get(`/kb/articles/${slug}/`);
      setArticle(r.data);
    } catch {
      toast.error("Failed to submit feedback");
    }
  };

  const loadHistory = async () => {
    try {
      const r = await api.get(`/kb/articles/${slug}/history/`);
      setVersions(r.data);
      setHistoryOpen(true);
    } catch { toast.error("Failed to load history"); }
  };

  const restoreVersion = async (versionId: string) => {
    if (!confirm("Are you sure you want to restore this version? This will overwrite the current content.")) return;
    try {
      await api.post(`/kb/articles/${slug}/restore/${versionId}/`);
      toast.success("Version restored successfully");
      setHistoryOpen(false);
      const r = await api.get(`/kb/articles/${slug}/`);
      setArticle(r.data);
    } catch { toast.error("Failed to restore version"); }
  };

  if (loading) return <div className="p-10 text-center">Loading article...</div>;
  if (!article) return <div className="p-10 text-center text-red-500">Article not found or you don't have permission to view it.</div>;

  return (
    <div className="flex flex-col w-full max-w-4xl mx-auto p-4 pb-20">
      <div className="mb-6">
        <Button variant="ghost" size="sm" onClick={() => router.push('/kb')} className="mb-4 -ml-2 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Knowledge Base
        </Button>

        <div className="flex flex-wrap gap-2 mb-3">
          <Badge className="bg-violet-100 text-violet-800 border-0 hover:bg-violet-200">{article.category_name}</Badge>
          {article.visibility !== 'ALL_STAFF' && <Badge variant="outline" className="border-red-200 text-red-700 bg-red-50">{article.visibility.replace('_', ' ')}</Badge>}
          {article.status === 'DRAFT' && <Badge variant="outline" className="border-yellow-200 text-yellow-700 bg-yellow-50">DRAFT</Badge>}
        </div>

        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-4 text-neutral-900 dark:text-neutral-100">
          {article.title}
        </h1>

        <div className="flex flex-wrap justify-between items-center gap-4 text-sm text-neutral-500 border-b border-neutral-200 dark:border-neutral-800 pb-4">
          <div className="flex items-center gap-4">
            <span className="font-medium text-neutral-700 dark:text-neutral-300">By {article.author_name}</span>
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> Updated {new Date(article.updated_at).toLocaleDateString()}</span>
            <span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> {article.view_count} views</span>
          </div>

          {(canEdit || article.author === user?.id) && (
            <div className="flex gap-2">
              {canEdit && <Button variant="outline" size="sm" onClick={loadHistory}><History className="w-3.5 h-3.5 mr-1"/> History</Button>}
              <Button size="sm" className="bg-violet-600 hover:bg-violet-700" onClick={() => router.push(`/kb/articles/${article.slug}/edit`)}>
                <Edit className="w-3.5 h-3.5 mr-1" /> Edit
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Content Rendered */}
      <div className="prose prose-violet dark:prose-invert max-w-none mb-12 min-h-[300px]">
        {article.content ? (
          <div dangerouslySetInnerHTML={{ __html: article.content }} />
        ) : (
          <p className="text-neutral-500 italic">No content available.</p>
        )}
      </div>

      {/* Tags */}
      {article.tags?.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-10 pt-6 border-t border-neutral-200 dark:border-neutral-800">
          {article.tags.map((t: any) => (
            <Badge key={t.id} variant="secondary" className="bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200">
              #{t.name}
            </Badge>
          ))}
        </div>
      )}

      {/* Related Articles */}
      {related.length > 0 && (
        <div className="mb-10">
          <h3 className="text-sm font-semibold text-neutral-500 uppercase tracking-wide mb-3">Related articles</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {related.map((r: any) => (
              <button
                key={r.id}
                onClick={() => router.push(`/kb/articles/${r.slug}`)}
                className="text-left flex items-start gap-3 p-3 rounded-lg border hover:border-violet-300 hover:bg-violet-50/40 dark:hover:bg-violet-900/10 transition-colors"
              >
                <FileText className="w-4 h-4 text-violet-500 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium text-sm text-violet-700 dark:text-violet-400 truncate">{r.title}</div>
                  {r.excerpt && <div className="text-xs text-neutral-500 line-clamp-1">{r.excerpt}</div>}
                </div>
                <ChevronRight className="w-4 h-4 text-neutral-300 ml-auto self-center shrink-0" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Feedback Section */}
      <Card className="p-6 bg-violet-50 dark:bg-violet-900/10 border-violet-100 dark:border-violet-900/30 flex flex-col items-center text-center">
        <h3 className="text-lg font-semibold mb-2">Was this article helpful?</h3>
        <p className="text-sm text-neutral-500 mb-4">
          {article.feedback_summary?.total > 0 ? 
            `${article.feedback_summary.helpful} out of ${article.feedback_summary.total} found this helpful.` : 
            "Be the first to provide feedback."}
        </p>
        
        <div className="flex gap-4">
          <Button 
            variant={feedback === true ? "default" : "outline"} 
            className={feedback === true ? "bg-emerald-600 hover:bg-emerald-700" : "hover:bg-emerald-50 hover:text-emerald-600"}
            onClick={() => submitFeedback(true)}
          >
            <ThumbsUp className="w-4 h-4 mr-2" /> Yes
          </Button>
          <Button 
            variant={feedback === false ? "default" : "outline"}
            className={feedback === false ? "bg-red-600 hover:bg-red-700" : "hover:bg-red-50 hover:text-red-600"}
            onClick={() => submitFeedback(false)}
          >
            <ThumbsDown className="w-4 h-4 mr-2" /> No
          </Button>
        </div>

        {showFeedbackBox && (
          <div className="mt-4 w-full max-w-md flex flex-col gap-2">
            <Textarea 
              placeholder="Tell us more (optional)..." 
              value={comment} 
              onChange={e => setComment(e.target.value)} 
              className="bg-white dark:bg-neutral-900"
            />
            <Button size="sm" onClick={() => submitFeedback(feedback!)}>Submit Comment</Button>
          </div>
        )}
      </Card>

      {/* History Dialog */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Version History</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-4">
            {versions.map((v: any, index: number) => (
              <div key={v.history_id} className="flex justify-between items-center p-3 border rounded-lg bg-neutral-50 dark:bg-neutral-900">
                <div>
                  <div className="font-medium text-sm flex items-center gap-2">
                    {index === 0 && <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">Current</Badge>}
                    {new Date(v.history_date).toLocaleString()}
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">Edited by: {v.history_user} | Status: {v.status} | Action: {v.history_type === '+' ? 'Created' : v.history_type === '~' ? 'Updated' : 'Deleted'}</div>
                </div>
                {index > 0 && (
                  <Button variant="outline" size="sm" onClick={() => restoreVersion(v.history_id)}>Restore</Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}
