# ✈️ Vincenty — Antigravity Flight Simulator

> A full-stack 3D flight routing engine that computes WGS-84 geodesic and constraint-aware flight paths between airports using the **Vincenty formula** on an interactive globe.



---

## 🌍 What is this?

Most flight path tools use the **Haversine formula** — a fast but inaccurate shortcut that treats the Earth as a perfect sphere, introducing up to **0.5% positional error** over long distances.

**Vincenty's formulae** solve the geodesic problem on a proper **WGS-84 ellipsoidal model of Earth**, rather than treating the planet as a perfect sphere. The implementation uses a Haversine fallback when the iterative solution does not converge near antipodal points.

Vincenty (the app) takes this a step further — it doesn't just display the shortest path. It runs an **A\* pathfinding algorithm** over the default 37×72 grid, applying penalties from configured environmental constraint zones. The resulting weighted route can be longer than the geodesic, while the UI reports estimates from a configured Boeing 787-9 aircraft model.

---

## ✨ Features

- **Interactive 3D Globe** — Rendered with Three.js & React Three Fiber, with high-resolution Earth textures, atmospheric scattering, and a dynamic cloud layer. Drag to rotate, scroll to zoom, click to set waypoints.
- **Vincenty Geodesic Routing** — WGS-84 ellipsoidal calculations with an iterative Haversine fallback for near-antipodal cases, with server computation timing exposed in the dashboard.
- **Constraint-Aware A\* Pathfinding** — Routes trade distance against simulated storm, turbulence, wind, and dust penalties.
- **Dual Path Visualisation** — See both the raw geodesic (shortest distance) and the constraint-aware route side by side on the globe.
- **Aircraft-Model Analytics** — Heuristic fuel burn, CO₂, flight time, cruising altitude, and range estimates from the configured Boeing 787-9 model.
- **Heuristic Weather Impact** — A transparent fuel-impact estimate based on the configured storm-penalty assumption, not live fuel telemetry.
- **Click-to-Set Waypoints** — Click anywhere on the globe or near a city pin to set origin/destination interactively.
- **Live Backend Status** — API health indicator with server computation stats (time, grid size, iterations, formula used).

---

## 🚀 Tech Stack

**Frontend**
| Tech | Purpose |
|------|---------|
| React 18 + Vite | UI framework & build tool |
| TypeScript | Type safety |
| Three.js + React Three Fiber | 3D globe rendering |
| Web Worker | Off-main-thread local A* fallback |
| Tailwind CSS + shadcn/ui | Styling & components |
| Zustand | Global state management |
| TanStack Query | Server state & data fetching |
| Zod | Schema validation |

**Backend**
| Tech | Purpose |
|------|---------|
| Python 3.10+ | Runtime |
| FastAPI + Uvicorn | API server |
| Vincenty Formula | WGS-84 geodesic calculation |
| A\* Pathfinding | Weather-aware route optimisation |
| SQLAlchemy + GeoAlchemy2 | ORM with PostGIS support |
| PostgreSQL + PostGIS | Optional persistence layer |
| LRU Cache | Route caching layer |

---

## 🛠️ Getting Started

### 1. Clone the repository
```bash
git clone https://github.com/vikram144f-cyber/Vincenty.git
cd Vincenty
```

### 2. Start the Backend
```bash
cd backend

# Create and activate a virtual environment (recommended)
python -m venv venv
source venv/bin/activate        # macOS/Linux
# .\venv\Scripts\Activate.ps1  # Windows

# Install dependencies
pip install -r requirements.txt

# Start the API server
   python -m uvicorn app.main:app --host 127.0.0.1 --reload --port 8000
```

The API will be live at `http://localhost:8000`.  
Visit `http://localhost:8000/docs` for the interactive Swagger documentation.

> **Note:** PostgreSQL/PostGIS is optional. If unavailable, the backend uses default constraint data and a local JSON file for saved route history so the globe and routing remain functional. The database connection attempt is bounded by `DB_CONNECT_TIMEOUT_SECONDS`.

### 3. Start the Frontend
Open a new terminal in the root directory:

```bash
npm install
npm run dev
```

Frontend runs at `http://localhost:8080` (or `http://localhost:5173`).

---

## ⚙️ Configuration

Create a `.env` file in the `backend/` directory:

```env
DATABASE_URL=postgresql://user:password@localhost/vincenty_db
HOST=127.0.0.1
PORT=8000
DEBUG=false
DB_CONNECT_TIMEOUT_SECONDS=3
FRONTEND_ORIGIN=http://localhost:8080
```

The frontend uses a root-level `.env`:

```env
VITE_API_URL=http://127.0.0.1:8000
```

---

## 🧮 How the Routing Works

```
1. User selects Origin → Destination (airport or globe click)
2. Backend receives coordinates
3. Vincenty formula computes the true geodesic path on WGS-84 ellipsoid
4. A* algorithm traverses a 37×72 spherical grid
5. Each grid cell is weighted by weather penalty (storms, turbulence, headwinds)
6. Optimal path is returned with waypoints and heuristic aircraft/fuel estimates
7. Both geodesic and optimised paths are rendered on the 3D globe; if the API is unavailable, the same grid search runs in a Web Worker
```

---

## 📊 Example Output Shape (JFK → IST)

The values below are illustrative UI output; route values depend on the selected constraints, grid, and aircraft configuration.

| Metric | Geodesic | Optimised |
|--------|----------|-----------|
| Distance | 8,047 km | 9,401 km |
| Flight Time | 8.9h | 10.4h |
| Fuel | — | 48.9t |
| CO₂ | — | 154.5t |
| Waypoints | — | 48 |
| Compute Time | — | 5.0ms |

> The optimized route is evaluated against simulated constraint penalties. This prototype does not ingest live aviation weather or flight-plan fuel data. PostgreSQL/PostGIS is optional; route history falls back to a local JSON file when the database is unavailable.

---

## 🤝 Contributing

1. Fork the project
2. Create your feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'Add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

This project is open-source and available under the [MIT License](LICENSE).

---

<p align="center">Built with the Vincenty formula — because the Earth isn't a sphere.</p>
