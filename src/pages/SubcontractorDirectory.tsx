import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Users, Building2, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SubcontractorForm } from "@/components/SubcontractorForm";
import { ExcelImportDialog } from "@/components/ExcelImportDialog";
import {
  getAllGCSubcontractors,
  addGCSubcontractor,
  updateGCSubcontractor,
  deleteGCSubcontractor,
  GCSubcontractor,
} from "@/lib/subcontractorMatching";
import { getCategoryColor } from "@/lib/tradeTypes";
import { getLicenseStatusBadge } from "@/lib/licenseStatusBadge";

export default function SubcontractorDirectory() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [subcontractors, setSubcontractors] = useState<GCSubcontractor[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<GCSubcontractor | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [subToDelete, setSubToDelete] = useState<GCSubcontractor | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [deleteAllConfirmOpen, setDeleteAllConfirmOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      setUserId(session.user.id);
      const subs = await getAllGCSubcontractors(session.user.id);
      setSubcontractors(subs);
    } catch (error) {
      console.error("Error loading data:", error);
      toast({
        title: "Error",
        description: "Failed to load subcontractors",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddNew = () => {
    setEditingSub(null);
    setIsFormOpen(true);
  };

  const handleEdit = (sub: GCSubcontractor) => {
    setEditingSub(sub);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (sub: GCSubcontractor) => {
    setSubToDelete(sub);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!subToDelete) return;

    try {
      await deleteGCSubcontractor(subToDelete.id);
      setSubcontractors(prev => prev.filter(s => s.id !== subToDelete.id));
      toast({
        title: "Deleted",
        description: `${subToDelete.company_name} has been removed from your directory.`,
      });
    } catch (error) {
      console.error("Delete error:", error);
      toast({
        title: "Error",
        description: "Failed to delete subcontractor",
        variant: "destructive",
      });
    } finally {
      setDeleteConfirmOpen(false);
      setSubToDelete(null);
    }
  };

  const handleDeleteAllConfirm = async () => {
    if (!userId) return;

    setIsDeletingAll(true);
    try {
      // Delete all subcontractors for this GC
      const { error } = await supabase
        .from("gc_subcontractors")
        .delete()
        .eq("gc_id", userId);

      if (error) throw error;

      setSubcontractors([]);
      toast({
        title: "Directory Cleared",
        description: "All subcontractors have been removed from your directory.",
      });
    } catch (error) {
      console.error("Delete all error:", error);
      toast({
        title: "Error",
        description: "Failed to delete all subcontractors",
        variant: "destructive",
      });
    } finally {
      setIsDeletingAll(false);
      setDeleteAllConfirmOpen(false);
    }
  };

  const handleFormSubmit = async (
    data: {
      company_name: string;
      license_number: string;
      license_status: string;
      license_expiration: string;
      contact_name: string;
      email: string;
      phone: string;
      city: string;
      state_code: string;
      notes: string;
    },
    tradeIds: string[]
  ) => {
    if (!userId) return;

    setIsSubmitting(true);

    try {
      if (editingSub) {
        // Update existing
        await updateGCSubcontractor(editingSub.id, data, tradeIds);
        toast({
          title: "Updated",
          description: `${data.company_name} has been updated.`,
        });
      } else {
        // Add new
        await addGCSubcontractor(userId, data, tradeIds);
        toast({
          title: "Added",
          description: `${data.company_name} has been added to your directory.`,
        });
      }

      setIsFormOpen(false);
      setEditingSub(null);
      await loadData(); // Refresh the list
    } catch (error) {
      console.error("Submit error:", error);
      toast({
        title: "Error",
        description: "Failed to save subcontractor",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Layout showSidebar>
        <div className="p-8 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout showSidebar>
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Users className="h-6 w-6" />
              My Subcontractors
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage your private subcontractor directory. These subs will be matched to your projects based on required trades.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsImportOpen(true)}>
              <Upload className="h-4 w-4 mr-2" />
              Import from Excel
            </Button>
            <Button onClick={handleAddNew}>
              <Plus className="h-4 w-4 mr-2" />
              Add Subcontractor
            </Button>
          </div>
        </div>

        {/* Content */}
        {subcontractors.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No subcontractors yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Add your trusted subcontractors to build your private directory. Enter their CSLB license number to auto-fill their information.
            </p>
            <Button onClick={handleAddNew}>
              <Plus className="h-4 w-4 mr-2" />
              Add Your First Subcontractor
            </Button>
          </div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>License</TableHead>
                  <TableHead>Trades</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subcontractors.map((sub) => (
                  <TableRow key={sub.id}>
                    <TableCell>
                      <div>
                        <div className="font-medium">{sub.company_name}</div>
                        {sub.contact_name && (
                          <div className="text-sm text-muted-foreground">{sub.contact_name}</div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sub.license_number ? (
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{sub.license_number}</span>
                          {(() => {
                            const badge = getLicenseStatusBadge(sub.license_status);
                            return badge ? (
                              <Badge variant={badge.variant} className="text-xs">
                                {badge.label}
                              </Badge>
                            ) : null;
                          })()}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {sub.trades.length > 0 ? (
                          sub.trades.slice(0, 3).map((trade) => (
                            <Badge
                              key={trade.trade_type_id}
                              variant="outline"
                              className={`text-xs ${getCategoryColor(trade.category)}`}
                            >
                              {trade.code}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-sm">No trades</span>
                        )}
                        {sub.trades.length > 3 && (
                          <Badge variant="outline" className="text-xs">
                            +{sub.trades.length - 3}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {sub.email && <div>{sub.email}</div>}
                        {sub.phone && <div className="text-muted-foreground">{sub.phone}</div>}
                        {!sub.email && !sub.phone && (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {sub.city || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEdit(sub)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDeleteClick(sub)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Delete All Button - Bottom Right */}
        {subcontractors.length > 0 && (
          <div className="flex justify-end mt-4">
            <Button 
              variant="destructive" 
              size="sm"
              onClick={() => setDeleteAllConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete All
            </Button>
          </div>
        )}

        {/* Add/Edit Dialog */}
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent 
            className="max-w-2xl max-h-[90vh]"
            onWheel={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>
                {editingSub ? "Edit Subcontractor" : "Add Subcontractor"}
              </DialogTitle>
              <DialogDescription>
                {editingSub
                  ? "Update the subcontractor's information below."
                  : "Enter a CSLB license number to auto-fill, or enter details manually."}
              </DialogDescription>
            </DialogHeader>
            <SubcontractorForm
              initialData={editingSub || undefined}
              initialTradeIds={editingSub?.trades.map(t => t.trade_type_id) || []}
              onSubmit={handleFormSubmit}
              onCancel={() => {
                setIsFormOpen(false);
                setEditingSub(null);
              }}
              isSubmitting={isSubmitting}
              submitLabel={editingSub ? "Update Subcontractor" : "Add Subcontractor"}
            />
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Subcontractor?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove <strong>{subToDelete?.company_name}</strong> from your directory? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Delete All Confirmation */}
        <AlertDialog open={deleteAllConfirmOpen} onOpenChange={setDeleteAllConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Entire Directory?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete <strong>all {subcontractors.length} subcontractors</strong> from your directory? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isDeletingAll}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteAllConfirm}
                disabled={isDeletingAll}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isDeletingAll ? "Deleting..." : "Delete All"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Excel Import Dialog */}
        {userId && (
          <ExcelImportDialog
            open={isImportOpen}
            onOpenChange={setIsImportOpen}
            userId={userId}
            onImportComplete={loadData}
          />
        )}
      </div>
    </Layout>
  );
}
