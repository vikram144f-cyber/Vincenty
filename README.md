# ✈️ Vincenty — Antigravity Flight Simulator

> A full-stack 3D flight routing engine that computes geodesic and weather-optimized flight paths between airports using the **Vincenty formula** on a real-time interactive globe.



---

## 🌍 What is this?

Most flight path tools use the **Haversine formula** — a fast but inaccurate shortcut that treats the Earth as a perfect sphere, introducing up to **0.5% positional error** over long distances.

**Vincenty's formulae** solve the geodesic problem on a proper **WGS-84 ellipsoidal model of Earth**, achieving sub-millimetre accuracy. This is the same standard used in professional aviation and GPS systems.

Vincenty (the app) takes this a step further — it doesn't just find the shortest path. It runs an **A\* pathfinding algorithm** over a 37×72 grid, routing around live weather constraints (storms, turbulence, headwinds) to find the path that minimises **fuel burn and CO₂ emissions**, even if that means flying a longer distance.

---

## ✨ Features

- **Interactive 3D Globe** — Rendered with Three.js & React Three Fiber, with high-resolution Earth textures, atmospheric scattering, and a dynamic cloud layer. Drag to rotate, scroll to zoom, click to set waypoints.
- **Vincenty Geodesic Routing** — WGS-84 ellipsoidal calculations for sub-millimetre path accuracy, computed server-side in ~5ms.
- **Weather-Optimised A\* Pathfinding** — Routes avoid storm cells, turbulence zones, and headwinds to minimise real-world fuel consumption.
- **Dual Path Visualisation** — See both the raw geodesic (shortest distance) and the weather-optimised route side by side on the globe.
- **Aircraft-Specific Analytics** — Fuel burn (tonnes), CO₂ emissions, flight time, cruising altitude, and Mach number — all per aircraft type (e.g. Boeing 787-9 Dreamliner).
- **Storm Avoidance Savings** — Real-time breakdown of how much fuel and emissions were saved by routing around weather systems.
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
| PostgreSQL + PostGIS | Spatial database (optional) |
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
python -m uvicorn app.main:app --reload --port 8000
```

The API will be live at `http://localhost:8000`.  
Visit `http://localhost:8000/docs` for the interactive Swagger documentation.

> **Note:** PostgreSQL/PostGIS is optional. If unavailable, the backend gracefully falls back to in-memory data so the globe and routing remain fully functional.

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
DEBUG=True
FRONTEND_ORIGIN=http://localhost:8080
```

The frontend uses a root-level `.env`:

```env
VITE_API_URL=http://localhost:8000
```

---

## 🧮 How the Routing Works

```
1. User selects Origin → Destination (airport or globe click)
2. Backend receives coordinates
3. Vincenty formula computes the true geodesic path on WGS-84 ellipsoid
4. A* algorithm traverses a 37×72 spherical grid
5. Each grid cell is weighted by weather penalty (storms, turbulence, headwinds)
6. Optimal path is returned with waypoints, fuel burn, CO₂, and savings data
7. Both geodesic and optimised paths are rendered on the 3D globe
```

---

## 📊 Example Output (JFK → IST)

| Metric | Geodesic | Optimised |
|--------|----------|-----------|
| Distance | 8,047 km | 9,401 km |
| Flight Time | 8.9h | 10.4h |
| Fuel | — | 48.9t |
| CO₂ | — | 154.5t |
| Waypoints | — | 48 |
| Compute Time | — | 5.0ms |

> The optimised route is longer in distance but avoids storm cells and headwinds, reducing fuel burn — exactly how real airlines plan routes.

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
