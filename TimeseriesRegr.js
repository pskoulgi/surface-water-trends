// FUNCTIONS /////////////////////////////////////////////////////////////////////////

var groupFeatureTimeseries = function(fc, groupByProp, detailForRegrProp) {
  var countDataPoints = function(f) {
    var numDataPoints = ee.List(f.get('fullTimeSeries'))
      .filter(maxFeatNoDataFilter)
      .length();
    return f.set('tsPtCount', numDataPoints);
  };
  
  var fcWithDetailNotNull = fc; //.filter(ee.Filter.notNull([detailForRegrProp]));
  var groupByFilter = ee.Filter.equals({leftField: groupByProp, rightField: groupByProp});
  var fcWithTimeseriesGrouped = ee.Join.saveAll({matchesKey: 'fullTimeSeries'})
    .apply(fcWithDetailNotNull.distinct(groupByProp), fcWithDetailNotNull, groupByFilter);
  
  var dataCountAdded = fcWithTimeseriesGrouped.map(countDataPoints);
  
  return dataCountAdded;
};

function fitLineToGroupedTimeseries (groupedTimeseries, pairToRegr, featureUniqueId) {
  
  var regrAllFeatures = groupedTimeseries.map(function(feat) {
    var featureTimeseries = ee.FeatureCollection(ee.List(feat.get('fullTimeSeries')));
    
    var xyPair = ee.Dictionary(pairToRegr);
    
    var slopeFit = featureTimeseries.filter(maxFeatNoDataFilter)
    .reduceColumns({
      reducer: ee.Reducer.sensSlope(),
      selectors: [xyPair.getString('x'), xyPair.getString('y')]
    }).rename({
      from: ['slope', 'offset'], 
      to: ['sl_perYr', 'offset']
    });
    
    var gatherPropsToSet = slopeFit.combine({
      season: xyPair.getString('yCombinedWithDetail'),
      // sl_perYr_abs: slopeFit.getNumber('sl_perYr').abs(), // breaks the code when slope is NaN, happens when full timeseries for regr is null
    });
    
    return ee.Feature(null, gatherPropsToSet)
      .setGeometry(feat.geometry())
      .copyProperties(feat, [featureUniqueId, 'tsPtCount']);
  });
  
  return regrAllFeatures;
}

function setDetailNameForInvalidFeatures(fc, dictWithDetailName) {
  return fc.map(function(f) {
    return f.set(
      'season', dictWithDetailName.getString('yCombinedWithDetail'),
      'sl_perYr', -9999)}); // set dummy value; use in featureview viz under rules
}
// PROCESSING /////////////////////////////////////////////////////////////////////////
var maxFeatNoDataFrac = 0.05;
var maxFeatNoDataFilter = ee.Filter.lt('nodataFrac', maxFeatNoDataFrac);
var minTimeseriesPointCount = 5;
var minTimeseriesPointsFilter = ee.Filter.gte('tsPtCount', minTimeseriesPointCount);

// FOR TRANSECTS 
var allIndiaFullTimeseries = ee.FeatureCollection('users/pradeepkoulgi/RiverChanges/publishV1/mainlandIndia_areasTs_txs');
var allTxsInRoi = allIndiaFullTimeseries//.filterBounds(roi);
var selectedTransects = allTxsInRoi;

print(selectedTransects);
Map.addLayer(allTxsInRoi.distinct('txId').aside(print, 'distinct txs'))

var dryFMATxs = selectedTransects.filterMetadata('season', 'equals', 'dry_fma');
var wetONDTxs = selectedTransects.filterMetadata('season', 'equals', 'wet_ond');
var prmDnWTxs = selectedTransects.filterMetadata('season', 'equals', 'prm_DnW');

var txsRegPairsDryFMA = ee.List([
  {x: 'year', y: 'water_ha', yCombinedWithDetail: 'dry_fma'}
]);
var txsRegPairsWetOND = ee.List([
  {x: 'year', y: 'water_ha', yCombinedWithDetail: 'wet_ond'}
]);
var txsRegPairsPrmDnW = ee.List([
  {x: 'year', y: 'water_ha', yCombinedWithDetail: 'prm_DnW'}
]);

// Group timeseries of each transect, filter out ones with too few timeseries points given the regr response of interest
var dryFMATxsGrouped_water = groupFeatureTimeseries(dryFMATxs, 'txId', ee.Dictionary(txsRegPairsDryFMA.get(0)).getString('y')); // TODO: Need to include a filter for count of non-null/NaN points. For each y output of interest
var dryFMATxsValid_water = dryFMATxsGrouped_water
  .filter(minTimeseriesPointsFilter);
var dryFMATxsInvalid_water = dryFMATxsGrouped_water
  .filter(minTimeseriesPointsFilter.not());
print(dryFMATxsValid_water, 'dryFMATxsValid_water');
var wetONDTxsGrouped_water = groupFeatureTimeseries(wetONDTxs, 'txId', ee.Dictionary(txsRegPairsWetOND.get(0)).getString('y'));
var wetONDTxsValid_water = wetONDTxsGrouped_water
  .filter(minTimeseriesPointsFilter);
var wetONDTxsInvalid_water = wetONDTxsGrouped_water
  .filter(minTimeseriesPointsFilter.not());
print(wetONDTxsValid_water, 'wetONDTxsValid_water');
var prmDnWTxsGrouped_water = groupFeatureTimeseries(prmDnWTxs, 'txId', ee.Dictionary(txsRegPairsPrmDnW.get(0)).getString('y'));
var prmDnWTxsValid_water = prmDnWTxsGrouped_water
  .filter(minTimeseriesPointsFilter);
var prmDnWTxsInvalid_water = prmDnWTxsGrouped_water
  .filter(minTimeseriesPointsFilter.not());
print(prmDnWTxsValid_water, 'prmDnWTxsGrouped_water');

// Run regression on every transect's timeseries for the given x-y pair
var dryFMAtrends = fitLineToGroupedTimeseries(dryFMATxsValid_water, ee.Dictionary(txsRegPairsDryFMA.get(0)), 'txId');
print(dryFMAtrends, 'dryFMAtrends water');
var wetONDtrends = fitLineToGroupedTimeseries(wetONDTxsValid_water, ee.Dictionary(txsRegPairsWetOND.get(0)), 'txId');
print(wetONDtrends, 'wetONDtrends water');
var prmDnWtrends = fitLineToGroupedTimeseries(prmDnWTxsValid_water, ee.Dictionary(txsRegPairsPrmDnW.get(0)), 'txId');
print(prmDnWtrends, 'prmDnWtrends water');

// For invalid transects, set season separately
var dryFMATxsInvalidSeasNameSet = setDetailNameForInvalidFeatures(dryFMATxsInvalid_water, ee.Dictionary(txsRegPairsDryFMA.get(0)));
var wetONDTxsInvalidSeasNameSet = setDetailNameForInvalidFeatures(wetONDTxsInvalid_water, ee.Dictionary(txsRegPairsWetOND.get(0)));
var prmDnWTxsInvalidSeasNameSet = setDetailNameForInvalidFeatures(prmDnWTxsInvalid_water, ee.Dictionary(txsRegPairsPrmDnW.get(0)));
var txsInvalid = dryFMATxsInvalidSeasNameSet.merge(wetONDTxsInvalidSeasNameSet).merge(prmDnWTxsInvalidSeasNameSet);

// Combine all regr results into a single table
var txWaterTrends = dryFMAtrends.merge(wetONDtrends).merge(prmDnWtrends).merge(txsInvalid);

// FOR BASINS
var basinsHybasLevelTag = '_level7';
var allIndiaFullTimeseriesBasins = ee.FeatureCollection('users/pradeepkoulgi/RiverChanges/publishV1/mainlandIndia_areasTs_basinsL7');
var allBasinsInRoi = allIndiaFullTimeseriesBasins//.filterBounds(roi); //.aside(print);
var selectedBasins = allBasinsInRoi;

print(selectedBasins, 'selectedBasins');

var dryFMABasins = selectedBasins.filterMetadata('season', 'equals', 'dry_fma');
var wetONDBasins = selectedBasins.filterMetadata('season', 'equals', 'wet_ond');
var prmDnWBasins = selectedBasins.filterMetadata('season', 'equals', 'prm_DnW');

var basinsRegPairsDryFMA = ee.Dictionary(txsRegPairsDryFMA.get(0));
var basinsRegPairsWetOND = ee.Dictionary(txsRegPairsWetOND.get(0));
var basinsRegPairsPrmDnW = ee.Dictionary(txsRegPairsPrmDnW.get(0));

// Group timeseries of each basin, filter out ones with too few timeseries points given the regr response of interest
var basinsTimeSeriesGrouped_dryFMA = groupFeatureTimeseries(dryFMABasins, 'HYBAS_ID', basinsRegPairsDryFMA.getString('y'));
var basinsValid_dryFMA = basinsTimeSeriesGrouped_dryFMA
  .filter(minTimeseriesPointsFilter);
var basinsInvalid_dryFMA = basinsTimeSeriesGrouped_dryFMA
  .filter(minTimeseriesPointsFilter.not());
print(basinsValid_dryFMA, 'basinsValid_dryFMA');
var basinsTimeSeriesGrouped_wetOND = groupFeatureTimeseries(wetONDBasins, 'HYBAS_ID', basinsRegPairsWetOND.getString('y'));
var basinsValid_wetOND = basinsTimeSeriesGrouped_wetOND
  .filter(minTimeseriesPointsFilter);
var basinsInvalid_wetOND = basinsTimeSeriesGrouped_wetOND
  .filter(minTimeseriesPointsFilter.not());
print(basinsValid_wetOND, 'basinsValid_wetOND');
var basinsTimeSeriesGrouped_prmDnW = groupFeatureTimeseries(prmDnWBasins, 'HYBAS_ID', basinsRegPairsPrmDnW.getString('y'));
var basinsValid_prmDnW = basinsTimeSeriesGrouped_prmDnW
  .filter(minTimeseriesPointsFilter);
var basinsInvalid_prmDnW = basinsTimeSeriesGrouped_prmDnW
  .filter(minTimeseriesPointsFilter.not());
print(basinsValid_prmDnW, 'basinsValid_prmDnW');

// Run regression on every basin's timeseries for the given x-y pair
var basinsValid_dryFMA_Trends = fitLineToGroupedTimeseries(basinsValid_dryFMA, basinsRegPairsDryFMA, 'HYBAS_ID');
print(basinsValid_dryFMA_Trends, 'basinsValid_dryFMA_Trends');
var basinsValid_wetOND_Trends = fitLineToGroupedTimeseries(basinsValid_wetOND, basinsRegPairsWetOND, 'HYBAS_ID');
print(basinsValid_wetOND_Trends, 'basinsValid_wetOND_Trends');
var basinsValid_prmDnW_Trends = fitLineToGroupedTimeseries(basinsValid_prmDnW, basinsRegPairsPrmDnW, 'HYBAS_ID');
print(basinsValid_prmDnW_Trends, 'basinsValid_prmDnW_Trends');

// For invalid basins, set season separately
var basinsInvalidSeasNameSet_dryFMA = setDetailNameForInvalidFeatures(basinsInvalid_dryFMA, basinsRegPairsDryFMA);
var basinsInvalidSeasNameSet_wetOND = setDetailNameForInvalidFeatures(basinsInvalid_wetOND, basinsRegPairsWetOND);
var basinsInvalidSeasNameSet_prmDnW = setDetailNameForInvalidFeatures(basinsInvalid_prmDnW, basinsRegPairsPrmDnW);
var basinsInvalid = basinsInvalidSeasNameSet_dryFMA.merge(basinsInvalidSeasNameSet_wetOND).merge(basinsInvalidSeasNameSet_prmDnW);

// Combine all regr results into a single table
var basinWaterTrends = basinsValid_dryFMA_Trends.merge(basinsValid_wetOND_Trends).merge(basinsValid_prmDnW_Trends).merge(basinsInvalid);

// EXPORTS ///////////////////////////////////////////////////////////////////////////
Export.table.toAsset({
  collection: txWaterTrends
    .select(['txId', 'season', 'sl_perYr', 'offset', 'tsPtCount']),
  description: 'txsTrends_mainlandIndia_publishV1',
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/txsTrends'
});

Export.table.toAsset({
  collection: basinWaterTrends
    .select(['HYBAS_ID', 'season', 'sl_perYr', 'offset', 'tsPtCount']),
  description: 'basinsTrends_mainlandIndia_publishV1',
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/basinsTrends'
});

// FEATUREVIEW EXPORTS ///////////////////////////////////////////////////////////////
// Basins
var selsBas = [
  'HYBAS_ID', 'season',
  'sl_perYr', 'offset',
  'tsPtCount'];
Export.table.toFeatureView({
  collection: basinsValid_dryFMA_Trends.merge(basinsInvalidSeasNameSet_dryFMA).select(selsBas),
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/basinsTrendsDry_fv',
  description: 'basinsL7Dry_mainlandIndia_publishV1_fv',
  maxFeaturesPerTile: 1500,
  thinningStrategy: 'HIGHER_DENSITY',
  thinningRanking: ['sl_perYr DESC']
});
Export.table.toFeatureView({
  collection: basinsValid_wetOND_Trends.merge(basinsInvalidSeasNameSet_wetOND).select(selsBas),
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/basinsTrendsWet_fv',
  description: 'basinsL7Wet_mainlandIndia_publishV1_fv',
  maxFeaturesPerTile: 1500,
  thinningStrategy: 'HIGHER_DENSITY',
  thinningRanking: ['sl_perYr DESC']
});
Export.table.toFeatureView({
  collection: basinsValid_prmDnW_Trends.merge(basinsInvalidSeasNameSet_prmDnW).select(selsBas),
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/basinsTrendsPrm_fv',
  description: 'basinsL7Prm_mainlandIndia_publishV1_fv',
  maxFeaturesPerTile: 1500,
  thinningStrategy: 'HIGHER_DENSITY',
  thinningRanking: ['sl_perYr DESC']
});

// Transects
var selsTxs = [
  'txId', 'season',
  'sl_perYr', 'offset',
  'tsPtCount'];
Export.table.toFeatureView({
  collection: dryFMAtrends.merge(dryFMATxsInvalidSeasNameSet).select(selsTxs),
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/txsTrendsDry_fv',
  description: 'txsDry_mainlandIndia_publishV1_fv',
  maxFeaturesPerTile: 2000,
  thinningStrategy: 'GLOBALLY_CONSISTENT',
  thinningRanking: ['sl_perYr DESC']
});
Export.table.toFeatureView({
  collection: wetONDtrends.merge(wetONDTxsInvalidSeasNameSet).select(selsTxs),
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/txsTrendsWet_fv',
  description: 'txsWet_mainlandIndia_publishV1_fv',
  maxFeaturesPerTile: 2000,
  thinningStrategy: 'GLOBALLY_CONSISTENT',
  thinningRanking: ['sl_perYr DESC']
});
Export.table.toFeatureView({
  collection: prmDnWtrends.merge(prmDnWTxsInvalidSeasNameSet).select(selsTxs),
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/txsTrendsPrm_fv',
  description: 'txsPrm_mainlandIndia_publishV1_fv',
  maxFeaturesPerTile: 2000,
  thinningStrategy: 'GLOBALLY_CONSISTENT',
  thinningRanking: ['sl_perYr DESC']
});

