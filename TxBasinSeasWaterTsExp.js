/* FUNCTIONS *********************************************/

// Given a season's image and its tag, calculate pixClass areas for all the
// features of interest, build a table
var calculateSeasonalWaterAreas = function(image, featColl, seasTag, fIdProp) {
  var areas = featColl.map(function(f) {
    var waterAreas = ee.Image(1).multiply(ee.Image.pixelArea()).divide(ee.Image(1e4)) // pixel areas in ha.
      .addBands(image)
      .reduceRegion({
        reducer: ee.Reducer.sum().group({groupField: 1, groupName: 'pixClass'}),
        geometry: ee.Feature(f).geometry(),
        crs: seasonalityComposProj.atScale(seasonalityComposScl),
        maxPixels: 1e9
      });
    
    var pixClassAreas = ee.List(waterAreas.get('groups')).map(function(el) {
      var d = ee.Dictionary(el);
      return [pixClassLabels.getString(d.getNumber('pixClass')).cat('_ha'), d.getNumber('sum')];
    });
    
    var pixelClassAreasDict = ee.Dictionary(pixClassAreas.flatten());
    var totalArea = pixelClassAreasDict.values().reduce(ee.Reducer.sum());
    
    // For non-existent category/ies in the region, we need to set area as 0, not leave as null.
    // This helps with running regression smoothly.
    // Setting a dummy feature here, because getNumber on non-existent property in Dictionary
    // gives error while in Feature gives null.
    // see https://groups.google.com/g/google-earth-engine-developers/c/IQazYu_IhXo/m/d1DFXrwVAgAJ
    // Null getsreplaced by 0
    var featWithAreas = ee.Feature(null, pixelClassAreasDict);
    var nullAreasHandledDict = ee.Dictionary(pixClassValues)
      .rename(
        pixClassLabels, 
        pixClassLabels.map(function(l) {return ee.String(l).cat('_ha')})
      )
      .map(function(k, v) {
        return ee.List([
          featWithAreas.getNumber(ee.String(k)),
          ee.Number(0)
        ]).reduce(ee.Reducer.firstNonNull());
      });
    
    var nodataFrac = nullAreasHandledDict.getNumber('nodata_ha').divide(totalArea);
    
    return ee.Feature(
      f.geometry(), 
      ee.Dictionary({season: seasTag, year: image.getNumber('year'), nodataFrac: nodataFrac})
        .combine(nullAreasHandledDict)
    ).copyProperties(f, [fIdProp]);
  });
  
  return areas;
};

// Calculate the time series of areas for all reagions and seasons, given the imColl of 
// water seasonality rasters, featColl of all regions and the name of property having unique Id of each region.
// Assumes that water seasonality raster image has a band for each "season", with 
// the first three and last 4 chars of the band name concatenated indicating the seasonality,
// which gets stored in the "season" property of the feature in the time series.
function calculateTimeseriesAreasForRegions (seasWaterImColl, regionsFeatColl, regionIdProp) { 
  return seasWaterImColl.map(function(im) {
    im = ee.Image(im);
    
    var seasonsNames = im.bandNames();
    var seasonsAreas = ee.FeatureCollection(seasonsNames.map(function(s) {
      s = ee.String(s);
      
      var seasTag = s.slice(0, 3).cat(s.slice(-4));
      var seasWaterAreas = calculateSeasonalWaterAreas(im.select(s), regionsFeatColl, seasTag, regionIdProp);
      
      return seasWaterAreas;
    })).flatten();
    
    return seasonsAreas;
  }).flatten();
}

/* INITIALIZATIONS ****************************************/ 

// Water occurrence composites season info are in properties of images of this collection.
// Same info available in all images, since couldn't save it commonly at the collection level in the script
var seasonalComposites = ee.ImageCollection('users/pradeepkoulgi/RiverChanges/publishV1/waterOccSeasComps');
var seasCompSample = ee.Image(seasonalComposites.first());
var seasonalityComposProj = seasCompSample.projection();
var seasonalityComposScl  = seasonalityComposProj.nominalScale();

var pixClassValues = {nodata: 0, notwater: 1, water: 2};
var pixClassLabels = ee.List(Object.keys(pixClassValues));

var india = ee.Feature(ee.FeatureCollection('users/pradeepkoulgi/indiaMainland').first());
var roi = india.geometry().simplify(100);
var hydroBasinsL7 = ee.FeatureCollection("WWF/HydroSHEDS/v1/Basins/hybas_7")
  .filterBounds(roi);
var statewiseTxsFolder = 'users/pradeepkoulgi/RiverChanges/publishV1/statewiseTxs';

/* PROCESSING *******************************************/ 

var seasonalityColl = seasonalComposites;
print(seasonalityColl, 'seasonality image collection');

// Calculate water areas using the seasonal composites with bothSeasons composite added
var statsSeasonalityAreas_l7basins = calculateTimeseriesAreasForRegions(seasonalityColl, hydroBasinsL7, 'HYBAS_ID');
print(statsSeasonalityAreas_l7basins.limit(10), 'statsSeasonalityAreas_l7basins like txs');

// Gather state-wise txs into a single featurecollection
var txsIds = ee.data.listAssets(statewiseTxsFolder);
var txsVarlengths = ee.FeatureCollection([]);
for (var i = 0; i < txsIds.assets.length; i++) {
  var id = txsIds.assets[i].id;
  txsVarlengths = txsVarlengths.merge(ee.FeatureCollection(id));
}

// Calculate water areas for transects
var statsSeasonalityAreas_txs      = calculateTimeseriesAreasForRegions(seasonalityColl, txsVarlengths, 'txId');
print(statsSeasonalityAreas_txs.limit(10), 'statsSeasonalityAreas_txs like txs');

/* EXPORTING ********************************************/ 

Export.table.toAsset({
  collection: statsSeasonalityAreas_l7basins, // Only level 7 basins in India. 
  description: 'mainlandIndia_areasTs_basinsL7',
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/mainlandIndia_areasTs_basinsL7'
});
Export.table.toAsset({
  collection: statsSeasonalityAreas_txs,
  description: 'mainlandIndia_areasTs_txs',
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/mainlandIndia_areasTs_txs'
});

/* VIZ-ING **********************************************/ 

var img = seasonalityColl.filterMetadata('year', 'equals', 2020).first();
Map.addLayer(img.select('drySeasCompos_fma'), {min:0, max:3}, 'dryfma');
Map.addLayer(img.select('wetSeasCompos_ond'), {min:0, max:3}, 'wetond');
Map.addLayer(img.select('prmSeasCompos_DnW'), {min:0, max:3}, 'bthDnW');
Map.addLayer(img.select('prmSeasCompos_DnW').eq(2), {min:0, max:1, palette: ['000000', 'ff0000']}, 'bthDnW 3');
Map.addLayer(img.select('drySeasCompos_fma').mask(), {min:0, max:3}, 'dryfma mask');
// print(img.reduceRegion(ee.Reducer.minMax(), img.select('drySeasCompos_fma').geometry().bounds(), 30, null, null, true, 1e15), 'minmax');
print(img.select('prmSeasCompos_DnW').eq(2).selfMask().multiply(ee.Image.pixelArea()).reduceRegion(ee.Reducer.sum(), img.select('drySeasCompos_fma').geometry().bounds(), 30, null, null, true, 1e15), 'eq 3 area');

