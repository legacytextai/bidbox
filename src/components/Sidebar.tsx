import SidebarNav from "./SidebarNav";

const Sidebar = () => {
  return (
    <aside className="hidden md:flex w-64 bg-card border-r border-border flex-col">
      <SidebarNav />
    </aside>
  );
};

export default Sidebar;
