## Demo

https://jal-durbin.vercel.app/

## Overview

**JalDurbin** is a geospatial decision-support engine designed for coastal Bangladesh (specifically Khulna and Satkhira). It maps coastal water quality and optimizes pedestrian routes to safe water sources. By factoring in live weather telemetry, walking path accessibility, and strict maternal health (salinity) thresholds, it guides residents to the safest functional pump.

Beyond individual routing, JalDurbin acts as a **digital twin deployment sandbox** to help organizations like Xylem optimize capital allocation for new water infrastructure (e.g., Solar RO units, Pond Sand Filters) before committing construction funds.

## The Problem

Coastal communities in Khulna and Satkhira face recurring water shortages, high salinity, and long walks to usable sources. A 2026 study of 66,234 households highlights the everyday cost:

* **4.65 months/year:** Average period without reliable drinking water.
* **16%:** Households with an on-premises drinking-water source.
* **~80%:** Households where women and girls collect water, often spending 1.5–6 hours daily.

Elevated water salinity is associated with 3.3–5.5× higher risks of gestational hypertension and preeclampsia. Because the closest source may be saline, broken, or hard to reach, straight-line distance alone can mislead families and infrastructure planners.

## Core Features

JalDurbin turns fragmented source, path, and environmental data into practical choices:

*  **Maternal-Safe Screening:** Flags water sources above a 300 mg/L sodium cutoff so users can compare safer options and see where salinity data is unmeasured.
* **Real Walking & Barrier Routing:** Accounts for rural paths, canals, embankments, walking time, and queue waits instead of relying on straight-line distance.
* **Seasonal & Rain Stress-Testing:** Lets users model dry-season shortages and rainy walk penalties (e.g., mud friction) to see how access shifts.
*  **Infrastructure Siting Support:** Lets partners test candidate locations for new infrastructure—estimating time saved, queue relief, and nearby demographic reach before field validation.

## Datasets

We integrate five major public datasets to build our digital twin routing network:

| Provider | Dataset | Application in JalDurbin | 
| :--- | :--- | :--- | 
| **WPDx** | Water Point Data Exchange | 18,873+ mapped water points (PSF, RO, Tubewells) with functional status. | 
| **BGS** | British Geological Survey | Groundwater chemistry and stoichiometry models for sodium levels. | 
| **UNICEF** | UNICEF Bangladesh | Household water and maternal health observations. | 
| **Zenodo** | Coastal Salinity Grid | High-resolution spatial interpolation for unmeasured ponds/wells. | 
| **World Bank** | Seasonal Climatology | Historical climate and dry-season availability windows. | 
| **OSM** | Geofabrik / OpenStreetMap | Vector walkways, rural embankments, and tidal river barriers. | 

## The Xylem Partnership Case

JalDurbin is designed to build on Xylem's existing coastal footprint (such as the successful Americares WASH partnership). We help ensure the *next* wave of capital allocation targets communities with the highest salinity and transit burdens by answering:

1. **See the Gap:** Where do existing sources underperform relative to demand and walking barriers?
2. **Compare Options:** Test possible investments virtually before committing scarce capital.
3. **Measure Impact:** Estimate the exact minutes saved and populations served per newly deployed asset.

## Tech Stack

* **Frontend:** React / Next.js
* **Mapping Engine:** Mapbox GL JS / Leaflet
* **Styling:** Tailwind CSS / IBM Carbon Design System
* **Deployment:** Vercel

---
