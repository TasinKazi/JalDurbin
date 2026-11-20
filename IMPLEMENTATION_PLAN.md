# JalDurbin: Coastal Water Access & Maternal-Safe Routing System
## System Architecture and Implementation Plan

### 1. Water Point CSV Ingestion Pipeline

Coastal water access data often originates from field surveys, non-governmental organizations, or municipal authorities. The ingestion engine handles messy real-world coordinates, missing values, and varying salinity scales.

#### A. Expected CSV Schema (`data/raw/water_points.csv`)
| Column | Type | Validation Rule | Description |
| :--- | :--- | :--- | :--- |
| `external_code` | string | Unique, Non-null | Source identifier (e.g. `WP-COAST-0042`) |
| `latitude` | float | $-90.0 \le y \le 90.0$ | WGS84 Latitude coordinate |
| `longitude` | float | $-180.0 \le x \le 180.0$ | WGS84 Longitude coordinate |
| `source_type` | enum | In standard set | `deep_tube_well`, `psf` (Pond Sand Filter), `rainwater_tank`, `ro_plant` |
| `functional_status` | enum | In standard set | `functional`, `partially_functional`, `dry`, `abandoned` |
| `salinity_ppt` | float | $\ge 0.0$ | Salinity in parts per thousand (ppt). Fresh: $<0.5$, Brackish: $0.5 - 30.0$ |
| `potable` | boolean | true/false | Independent bacteriological/chemical potability verification |
| `queue_time_mins` | integer | $\ge 0$ | Average waiting queue time during peak collection hours |
| `elevation_m` | float | Optional | Elevation above sea level in meters |

#### B. Pipeline Processing Stages
1. **Validation & Cleansing**: Read CSV in chunks via `pandas`/`pydantic`. Drop or flag invalid coordinates outside the target coastal bounding box.
2. **Spatial Geometry Construction**: Construct `ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)`.
3. **Graph Snapping**: For each water point, query the nearest road edge using PostGIS `ST_ClosestPoint` or pre-index the nearest graph vertex ID.
4. **Idempotent Upsert**: Use PostgreSQL `ON CONFLICT (external_code) DO UPDATE` to allow incremental updates without duplicating records.

---

### 2. Maternal-Safe Routing Engine Formulation

Standard shortest-path routing minimizes metric distance ($D = \sum L_e$). For pregnant or postpartum women in coastal regions, distance is secondary to gradient, surface traction, and tidal exposure.

#### A. Edge Cost Function
$$C(e) = L_e \times \Big( 1 + w_{\text{slope}} \cdot \phi(\text{slope}_e) + w_{\text{surface}} \cdot S_e + w_{\text{hazard}} \cdot H_e + w_{\text{fatigue}} \cdot F(d) \Big)$$

- **$\phi(\text{slope}_e)$ (Slope Penalty)**:
  - $\le 3\%$: $\phi = 0$ (Gentle terrain)
  - $3\% < \text{slope} \le 6\%$: $\phi = 1.5 \times (\text{slope} - 0.03)$
  - $6\% < \text{slope} \le 8\%$: $\phi = 4.0 \times (\text{slope} - 0.03)$
  - $> 8\%$: Edge cost set to $\infty$ (Strict cutoff: bypass steep embankments or mud levees)
- **$S_e$ (Surface Roughness)**:
  - Paved / Brick soling: $S_e = 0.0$
  - Compacted gravel: $S_e = 0.3$
  - Unpaved dirt: $S_e = 1.0$
  - Tidal mud / slippery clay: $S_e = 4.0$ (disfavored)
- **$H_e$ (Tidal and Inundation Hazard)**:
  - Submerged during current/forecast high tide: $H_e = \infty$
  - Low-lying berm without lighting/shade: $H_e = 1.5$
- **$F(d)$ (Carrying Burden Return Factor)**:
  - Return route (from water point to home with 15–20 kg load) incurs non-linear distance penalties:
  $$F(d) = \left(\frac{d}{1000\text{ m}}\right)^{1.4}$$

#### B. Dynamic Routing Toggle in API & Frontend
- **Frontend Toggle**: Swapping `Maternal-Safe Mode` sends `mode: "maternal_safe"` with adjustable sliders for `max_slope` (default 6%) and `avoid_unpaved` (default true).
- **Backend Graph Weights**: The routing engine dynamically selects the pre-weighted edge graph or adjusts weights in the `pgRouting` query (`pgr_dijkstra` or `pgr_astar`).
