function convertLongToWide(featIdYearFc, featIdProp) {
  function pivotWider(fIdYear) {
    var fIdYearSeasons = ee.FeatureCollection(ee.List(fIdYear.get('seasons')));
    var featWide = fIdYearSeasons.map(function(s) {
      var sWaterColName = ee.Feature(s).getString('season').cat('_water_ha');
      var sNodataColName = ee.Feature(s).getString('season').cat('_nodata_ha');
      return fIdYear.set({seas_water_name: sWaterColName, seas_nodata_name: sNodataColName});
    });
    var waterDict = ee.Dictionary.fromLists(
      featWide.aggregate_array('seas_water_name'),
      featWide.aggregate_array('water_ha'));
    var nodataDict = ee.Dictionary.fromLists(
      featWide.aggregate_array('seas_nodata_name'),
      featWide.aggregate_array('nodata_ha'));
    return ee.Feature(null, {area_ha: fIdYear.area(50).divide(1e4)})
      .copyProperties(fIdYear, [fIdProp, 'year'])
      .set(waterDict.combine(nodataDict));
  }

  var fIdProp = featIdProp;
  var fcPivot = featIdYearFc.map(pivotWider);
  return fcPivot;
}

//////// READ DATA, INITIALIZE //////////////////////////////////////////////////

var regrResBas = ee.FeatureCollection('users/pradeepkoulgi/RiverChanges/publishV1/basinsTrends');
var regrResTxs = ee.FeatureCollection('users/pradeepkoulgi/RiverChanges/publishV1/txsTrends');

var tsAreasBas = ee.FeatureCollection('users/pradeepkoulgi/RiverChanges/publishV1/mainlandIndia_areasTs_basinsL7');
var tsAreasTxs = ee.FeatureCollection('users/pradeepkoulgi/RiverChanges/publishV1/mainlandIndia_areasTs_txs');

var basIdProp = 'HYBAS_ID';
var txsIdProp = 'txId';
var timeProp = 'year';

//////// PROCESSING /////////////////////////////////////////////////////////////

// Timeseries, all together and broken up by season

// Basins
var basIdsAndYears = tsAreasBas.distinct([basIdProp, timeProp]);
var matchingIdAndYearFilt_bas = ee.Filter.and(
  ee.Filter.equals({leftField: basIdProp, rightField: basIdProp}),
  ee.Filter.equals({leftField: timeProp, rightField: timeProp}));

// All seasons together
var basSeasonsJoinedToYear = ee.Join.saveAll({matchesKey: 'seasons', ordering: timeProp})
  .apply(basIdsAndYears, tsAreasBas, matchingIdAndYearFilt_bas);
// print(basSeasonsJoinedToYear, 'basSeasonsJoinedToYear');
var basWide = convertLongToWide(basSeasonsJoinedToYear, basIdProp);
// print(basWide, 'basWide');
var basDlSels = [
  basIdProp, 'area_ha', timeProp, 
  'dry_fma_nodata_ha', 'dry_fma_water_ha',
  'wet_ond_nodata_ha', 'wet_ond_water_ha', 
  'prm_DnW_nodata_ha', 'prm_DnW_water_ha'];
var basDlSelsRenamed = [
  basIdProp, 'area_ha', timeProp, 
  'dry_fma_nodata_ha', 'dry_fma_water_ha',
  'wet_ond_nodata_ha', 'wet_ond_water_ha', 
  'total_nodata_ha', 'prm_DnW_water_ha'];
var basWideDlReady = basWide.select(basDlSels, basDlSelsRenamed);

// Transects
var txsIdsAndYears = tsAreasTxs.distinct([txsIdProp, timeProp]);
var matchingIdAndYearFilt_txs = ee.Filter.and(
  ee.Filter.equals({leftField: txsIdProp, rightField: txsIdProp}),
  ee.Filter.equals({leftField: timeProp, rightField: timeProp}));

// All seasons together
var txsSeasonsJoinedToYear = ee.Join.saveAll({matchesKey: 'seasons', ordering: timeProp})
  .apply(txsIdsAndYears, tsAreasTxs, matchingIdAndYearFilt_txs);
var txsWide = convertLongToWide(txsSeasonsJoinedToYear, txsIdProp);
var txsDlSels = [
  txsIdProp, 'area_ha', timeProp, 
  'dry_fma_nodata_ha', 'dry_fma_water_ha',
  'wet_ond_nodata_ha', 'wet_ond_water_ha', 
  'prm_DnW_nodata_ha', 'prm_DnW_water_ha'];
var txsDlSelsRenamed = [
  txsIdProp, 'area_ha', timeProp, 
  'dry_fma_nodata_ha', 'dry_fma_water_ha',
  'wet_ond_nodata_ha', 'wet_ond_water_ha', 
  'total_nodata_ha', 'prm_DnW_water_ha'];
var txsWideDlReady = txsWide.select(txsDlSels, txsDlSelsRenamed);

//////// EXPORTS ////////////////////////////////////////////////////////////////

// Timeseries areas of basins
Export.table.toDrive({
  collection: basWideDlReady,
  description: "annualTimeseriesBasins",
  folder: "gee",
  fileFormat: "CSV",
  selectors: basDlSelsRenamed
});

// Timeseries areas of transects
Export.table.toDrive({
  collection: txsWideDlReady,
  description: "annualTimeseriesTransects",
  folder: "gee",
  fileFormat: "CSV",
  selectors: txsDlSelsRenamed
});

// Trends
Export.table.toDrive({
  collection: regrResBas.filter(ee.Filter.eq("season", "dry_fma")),
  description: "annualTrendsBasins_dry",
  folder: "gee",
  fileFormat: "SHP"
});
Export.table.toDrive({
  collection: regrResBas.filter(ee.Filter.eq("season", "wet_ond")),
  description: "annualTrendsBasins_wet",
  folder: "gee",
  fileFormat: "SHP"
});
Export.table.toDrive({
  collection: regrResBas.filter(ee.Filter.eq("season", "prm_DnW")),
  description: "annualTrendsBasins_permanent",
  folder: "gee",
  fileFormat: "SHP"
});
Export.table.toDrive({
  collection: regrResBas,
  description: "annualTrendsBasins",
  folder: "gee",
  fileFormat: "SHP"
});
Export.table.toDrive({
  collection: regrResTxs.filter(ee.Filter.eq("season", "dry_fma")),
  description: "annualTrendsTransects_dry",
  folder: "gee",
  fileFormat: "SHP"
});
Export.table.toDrive({
  collection: regrResTxs.filter(ee.Filter.eq("season", "wet_ond")),
  description: "annualTrendsTransects_wet",
  folder: "gee",
  fileFormat: "SHP"
});
Export.table.toDrive({
  collection: regrResTxs.filter(ee.Filter.eq("season", "prm_DnW")),
  description: "annualTrendsTransects_permanent",
  folder: "gee",
  fileFormat: "SHP"
});
Export.table.toDrive({
  collection: regrResTxs,
  description: "annualTrendsTransects",
  folder: "gee",
  fileFormat: "SHP"
});
