# Surface water trends in India's rivers and basins

This repository contains [Google Earth Engine](https://earthengine.google.com/) code behind the analysis for our publication on surface water area trends for rivers and basins in India. This is work done in collaboration with [Suman Jumani](https://github.com/SumanJumani).

To reproduce our analysis, follow these steps:
1. Create season-wise annual composites of surface water occurrence history, by running [`MakeSeasonalComps.js`](MakeSeasonalComps.js).
2. Delineate transects across rivers, by first running [`FindTransectLocations.js`](FindTransectLocations.js) to find their locations along the river channels and then running [`MakeTransects.js`](MakeTransects.js) to delineate transects across them. Delineations of basins around rivers are publicly available, and can be chosen from, the [HydroBASINS](https://www.hydrosheds.org/products/hydrobasins) dataset. We used level 7 basins in our analysis.
3. For these basins and transects, calculate time series of surface water areas using the annual composites from 1. above, by running [`TxBasinSeasWaterTsExp.js`](TxBasinSeasWaterTsExp.js).
4. Estimate trends, by season, in annual surface water area changes for each basin and transect by running [`TimeseriesRegr.js`](TimeseriesRegr.js).

# License

This work is licensed under the creative commons license [CC-BY-SA-4.0](https://creativecommons.org/licenses/by-sa/4.0/).
