import { Sidebar } from "./components/Sidebar";
import { LibraryPage } from "./pages/LibraryPage";
import { getPlatform } from "./platform";

const App = () => {
  const platform = getPlatform();
  return (
    <div className="min-h-screen bg-graphite-900 text-white">
      {platform === "desktop" ? (
        <div className="flex h-full gap-6 p-6">
          <Sidebar />
          <main className="flex-1">
            <LibraryPage />
          </main>
        </div>
      ) : (
        <main className="h-full w-full p-3 sm:p-4">
          <LibraryPage />
        </main>
      )}
    </div>
  );
};

export default App;
