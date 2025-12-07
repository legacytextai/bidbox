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
import { Plus, Pencil, Trash2, Shield, Building2, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { SubcontractorForm } from "@/components/SubcontractorForm";
import { getCategoryColor } from "@/lib/tradeTypes";
import { lookupCSLBLicense } from "@/lib/subcontractorMatching";

interface NetworkSubcontractor {
  id: string;
  company_name: string;
  license_number: string | null;
  license_status: string | null;
  license_expiration: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  state_code: string | null;
  is_verified: boolean;
  notes: string | null;
  created_at: string;
  trades: {
    trade_type_id: string;
    code: string;
    name: string;
    category: string | null;
  }[];
}

export default function AdminNetworkSubs() {
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [subcontractors, setSubcontractors] = useState<NetworkSubcontractor[]>([]);
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingSub, setEditingSub] = useState<NetworkSubcontractor | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [subToDelete, setSubToDelete] = useState<NetworkSubcontractor | null>(null);

  useEffect(() => {
    checkAdminAndLoad();
  }, []);

  const checkAdminAndLoad = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate("/auth");
        return;
      }

      // Check if user is admin
      const { data: roleData } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('role', 'admin')
        .maybeSingle();

      if (!roleData) {
        toast({
          title: "Access Denied",
          description: "You don't have permission to access this page.",
          variant: "destructive",
        });
        navigate("/projects");
        return;
      }

      setIsAdmin(true);
      await loadSubcontractors();
    } catch (error) {
      console.error("Error checking admin:", error);
      navigate("/projects");
    } finally {
      setLoading(false);
    }
  };

  const loadSubcontractors = async () => {
    try {
      // Fetch all network subcontractors
      const { data: subs, error: subsError } = await supabase
        .from('subcontractors')
        .select('*')
        .order('company_name');

      if (subsError) throw subsError;

      if (!subs || subs.length === 0) {
        setSubcontractors([]);
        return;
      }

      // Fetch trade mappings
      const subIds = subs.map(s => s.id);
      const { data: tradeMappings, error: mappingsError } = await supabase
        .from('sub_trade_mappings')
        .select(`
          sub_id,
          trade_type_id,
          trade_types (
            id,
            code,
            name,
            category
          )
        `)
        .in('sub_id', subIds);

      if (mappingsError) {
        console.error('Error fetching trade mappings:', mappingsError);
      }

      // Build result with trades
      const result: NetworkSubcontractor[] = subs.map(sub => ({
        ...sub,
        trades: tradeMappings
          ?.filter(m => m.sub_id === sub.id)
          .map(m => ({
            trade_type_id: m.trade_type_id,
            code: (m.trade_types as any)?.code || '',
            name: (m.trade_types as any)?.name || '',
            category: (m.trade_types as any)?.category || null,
          })) || [],
      }));

      setSubcontractors(result);
    } catch (error) {
      console.error("Error loading subcontractors:", error);
      toast({
        title: "Error",
        description: "Failed to load network subcontractors",
        variant: "destructive",
      });
    }
  };

  const handleAddNew = () => {
    setEditingSub(null);
    setIsFormOpen(true);
  };

  const handleEdit = (sub: NetworkSubcontractor) => {
    setEditingSub(sub);
    setIsFormOpen(true);
  };

  const handleDeleteClick = (sub: NetworkSubcontractor) => {
    setSubToDelete(sub);
    setDeleteConfirmOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!subToDelete) return;

    try {
      const { error } = await supabase
        .from('subcontractors')
        .delete()
        .eq('id', subToDelete.id);

      if (error) throw error;

      setSubcontractors(prev => prev.filter(s => s.id !== subToDelete.id));
      toast({
        title: "Deleted",
        description: `${subToDelete.company_name} has been removed from the network.`,
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
    setIsSubmitting(true);

    try {
      if (editingSub) {
        // Update existing
        const { error: updateError } = await supabase
          .from('subcontractors')
          .update({
            company_name: data.company_name,
            license_number: data.license_number || null,
            license_status: data.license_status || null,
            license_expiration: data.license_expiration || null,
            contact_name: data.contact_name || null,
            email: data.email || null,
            phone: data.phone || null,
            city: data.city || null,
            state_code: data.state_code || 'CA',
            notes: data.notes || null,
          })
          .eq('id', editingSub.id);

        if (updateError) throw updateError;

        // Update trade mappings
        await supabase
          .from('sub_trade_mappings')
          .delete()
          .eq('sub_id', editingSub.id);

        if (tradeIds.length > 0) {
          const tradeMappings = tradeIds.map(tradeTypeId => ({
            sub_id: editingSub.id,
            trade_type_id: tradeTypeId,
          }));

          await supabase
            .from('sub_trade_mappings')
            .insert(tradeMappings);
        }

        toast({
          title: "Updated",
          description: `${data.company_name} has been updated.`,
        });
      } else {
        // Add new
        const { data: newSub, error: insertError } = await supabase
          .from('subcontractors')
          .insert({
            company_name: data.company_name,
            license_number: data.license_number || null,
            license_status: data.license_status || null,
            license_expiration: data.license_expiration || null,
            contact_name: data.contact_name || null,
            email: data.email || null,
            phone: data.phone || null,
            city: data.city || null,
            state_code: data.state_code || 'CA',
            notes: data.notes || null,
            is_verified: true, // Admin-added subs are verified
          })
          .select()
          .single();

        if (insertError) throw insertError;

        // Add trade mappings
        if (tradeIds.length > 0 && newSub) {
          const tradeMappings = tradeIds.map(tradeTypeId => ({
            sub_id: newSub.id,
            trade_type_id: tradeTypeId,
          }));

          await supabase
            .from('sub_trade_mappings')
            .insert(tradeMappings);
        }

        toast({
          title: "Added",
          description: `${data.company_name} has been added to the network.`,
        });
      }

      setIsFormOpen(false);
      setEditingSub(null);
      await loadSubcontractors();
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

  if (!isAdmin) {
    return null;
  }

  return (
    <Layout showSidebar>
      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/admin/analytics")}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to Analytics
              </Button>
            </div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Network Subcontractors
            </h1>
            <p className="text-muted-foreground mt-1">
              Admin-only: Manage the BidBox curated subcontractor network. These subs will be available to all GCs.
            </p>
          </div>
          <Button onClick={handleAddNew}>
            <Plus className="h-4 w-4 mr-2" />
            Add Network Sub
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="p-4 border border-border rounded-lg bg-card">
            <div className="text-2xl font-bold">{subcontractors.length}</div>
            <div className="text-sm text-muted-foreground">Total Subs</div>
          </div>
          <div className="p-4 border border-border rounded-lg bg-card">
            <div className="text-2xl font-bold">
              {subcontractors.filter(s => s.is_verified).length}
            </div>
            <div className="text-sm text-muted-foreground">Verified</div>
          </div>
          <div className="p-4 border border-border rounded-lg bg-card">
            <div className="text-2xl font-bold">
              {new Set(subcontractors.flatMap(s => s.trades.map(t => t.code))).size}
            </div>
            <div className="text-sm text-muted-foreground">Unique Trades</div>
          </div>
          <div className="p-4 border border-border rounded-lg bg-card">
            <div className="text-2xl font-bold">
              {new Set(subcontractors.map(s => s.city).filter(Boolean)).size}
            </div>
            <div className="text-sm text-muted-foreground">Cities Covered</div>
          </div>
        </div>

        {/* Content */}
        {subcontractors.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-border rounded-lg">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">Network is empty</h3>
            <p className="text-muted-foreground mb-6 max-w-md mx-auto">
              Start building the BidBox network by adding verified subcontractors. Use CSLB lookup to auto-fill their information.
            </p>
            <Button onClick={handleAddNew}>
              <Plus className="h-4 w-4 mr-2" />
              Add First Network Sub
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
                  <TableHead>City</TableHead>
                  <TableHead>Status</TableHead>
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
                          {sub.license_status && (
                            <Badge
                              variant={sub.license_status === "ACTIVE" ? "default" : "destructive"}
                              className="text-xs"
                            >
                              {sub.license_status}
                            </Badge>
                          )}
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
                      {sub.city || <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant={sub.is_verified ? "default" : "secondary"}>
                        {sub.is_verified ? "Verified" : "Pending"}
                      </Badge>
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

        {/* Add/Edit Dialog */}
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingSub ? "Edit Network Subcontractor" : "Add Network Subcontractor"}
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
              submitLabel={editingSub ? "Update Subcontractor" : "Add to Network"}
            />
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation */}
        <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Network Subcontractor?</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove <strong>{subToDelete?.company_name}</strong> from the BidBox network? This action cannot be undone.
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
      </div>
    </Layout>
  );
}
