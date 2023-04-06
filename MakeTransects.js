//////// FUNCTIONS //////////////////////////////////////////////////////////////
function flowAccWiseTxLengths(flowAccRange, vertTxHalflength) {
  var flowAccRangeFilter = ee.Filter.and(
    ee.Filter.gte('flowAccum', ee.List(flowAccRange).getNumber(0)),
    ee.Filter.lt( 'flowAccum', ee.List(flowAccRange).getNumber(1))
  );
  var diagTxFilter = ee.Filter.inList({leftField: 'perpFlow1', rightValue: [45, 135, 225, 315]});
  var diagTxHalfLength = ee.Number(vertTxHalflength).multiply(Math.sqrt(2));
  
  var inRangeTxs = txLocsWithDirs.filter(flowAccRangeFilter); //.aside(print, 'inRangeTxs');
  var inRangeDiagTxs = inRangeTxs.filter(diagTxFilter)
    .map(function(f) {return f.set('txLen', diagTxHalfLength)}); //.aside(print, 'inRangeDiagTxs');
  var inRangeVertHorizTxs = inRangeTxs.filter(diagTxFilter.not())
    .map(function(f) {return f.set('txLen', vertTxHalflength)}); //.aside(print, 'inRangeVertHorizTxs');
  
  return inRangeDiagTxs.merge(inRangeVertHorizTxs);
}

// Function to draw txs by perp dir
function drawTransect(d) {
  var pointsInDird = ee.FeatureCollection(ee.List(d.get('points')));
  
  // Find the set of lengths in the given direction. To map over these lengths
  var txLengthsInDird = pointsInDird.distinct('txLen');
  
  // For the given dir, group points by tx lengths
  var groupByLenFilt = ee.Filter.equals({leftField: 'txLen', rightField: 'txLen'});
  var pointsByLen = ee.Join.saveAll('txLengthwisePoints')
    .apply(txLengthsInDird, pointsInDird, groupByLenFilt);
  
  // Draw txs, a length at a time
  var txsByLen = pointsByLen.map(function(len) {
    var dirdLenPoints = ee.FeatureCollection(ee.List(len.get('txLengthwisePoints')));
    
    // Make a pixels out of all points in perp dir d
    var chosenPoint = dirdLenPoints.reduceToImage(['flowAccum'], ee.Reducer.first()).rename('chosenPoints');
    
    // Draw transect at all chosen points together, one arm at a time 
    var perpFlowDir1 = d.getNumber('dir');
    var perpFlowDir2 = perpFlowDir1.add(180);
    
    // Get the transect length corresponding to the perpFlowDir's
    var transectLen = len.getNumber('txLen');
    
    // directionalDistanceTransform was giving internal error
    // The 512 maxDistance and then chopping it of was Noel's temp workaround
    // https://groups.google.com/g/google-earth-engine-developers/c/6cIRjmccPwc/m/92I2qBR8AQAJ
    var dirdist = chosenPoint.unmask(0).directionalDistanceTransform(perpFlowDir1, 512);
    // transectLen is transectLen+1th pixel from the mid point
    dirdist = dirdist.updateMask(dirdist.lte(transectLen));
    var dirdist2 = chosenPoint.unmask(0).directionalDistanceTransform(perpFlowDir2, 512);
    // transectLen is transectLen+1th pixel from the mid point
    dirdist2 = dirdist2.updateMask(dirdist2.lte(transectLen));
    // Without the unmask()s below, neither dirdist nor dirdist2 makes it to the result
    // because each is masked where the other is not, except for the focal point 
    var chosenPointTransect = dirdist.select('distance').unmask(0)
      .add(dirdist2.select('distance').unmask(0))
      .add(chosenPoint.unmask(0))
      .reproject({crs: opProj.atScale(opRes)}) // since dirdist are in pixels units
      .rename('rasterTxs');
    chosenPoint = chosenPoint.reproject({crs: opProj.atScale(opRes)});
    
    return ee.Image.cat([chosenPointTransect, chosenPoint]);
  });
  
  return txsByLen;
}

function addProjToDummyResultIms(im) {
  return ee.ImageCollection(im).map(function(im) {
    return im.reproject({crs: opProj.atScale(opRes)});
  });
}

function addTxIdPropFromCentroid(f) {
  var fCent = ee.Feature(f).centroid(10).geometry().coordinates();
  var txIdFromCent = fCent.getNumber(0).format('%2.4f').cat('_').cat(fCent.getNumber(1).format('%2.4f'));
  return f.set({txId: txIdFromCent});
}

//////// READ DATA //////////////////////////////////////////////////////////////
var flowAcc = ee.Image("WWF/HydroSHEDS/15ACC");
var waterOcc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence');
var indiaMainland = ee.Feature(ee.FeatureCollection('users/pradeepkoulgi/indiaMainland').first());
var indiaStates = ee.FeatureCollection('users/pradeepkoulgi/indiaStates');
var riverPointsMinDistApart = ee.FeatureCollection('users/pradeepkoulgi/RiverChanges/publishV1/indiaMainland_txLocsWithDirs');

// For debugging, can select a fraction of the points, randomly
var txLocsWithDirs = riverPointsMinDistApart; // .randomColumn()
  // .filter('random <= 1e-2');
print(txLocsWithDirs.aggregate_max('flowAccum'), 'max flowacc');
print(txLocsWithDirs, 'txLocsWithDirs');
// Map.addLayer(txLocsWithDirs, {}, 'txLocsWithDirs');

//////// DEFINE FEW BASICS //////////////////////////////////////////////////////
var flowAccProj = flowAcc.projection();
var flowAccNomScale = flowAccProj.nominalScale();
var waterOccProj = waterOcc.projection();
var waterOccNomScale = waterOccProj.nominalScale();


//////// INPUTS TO SET //////////////////////////////////////////////////////////
var opProj = waterOccProj;
var opRes = opProj.nominalScale().multiply(3);
var flowAccThresh = 5000;

// Boundaries of flow acc values, and their corresponding half transect lengths
var flowAccBinBoundaries = ee.List([5e3, 1202e3, 3269e3, 1e12]);
var txLengthsForBins     = ee.List([          4,      5,    6]);

// The 8 degree values in 0-360 available in flow direction data 
// https://developers.google.com/earth-engine/datasets/catalog/WWF_HydroSHEDS_15DIR
var flowDirDeg = ee.List([180, 225, 270, 315,  0,  45, 90, 135]);
var roi = indiaMainland.set('name', 'indiaMainland');

//////// PROCESSING /////////////////////////////////////////////////////////////

// Assign transect lengths to transect locs, based on flow acc value at its center
var txInBucket0 = flowAccWiseTxLengths(flowAccBinBoundaries.slice(0, 2), txLengthsForBins.getNumber(0));
var txInBucket1 = flowAccWiseTxLengths(flowAccBinBoundaries.slice(1, 3), txLengthsForBins.getNumber(1));
var txInBucket2 = flowAccWiseTxLengths(flowAccBinBoundaries.slice(2, 4), txLengthsForBins.getNumber(2));
var txLocsWithDirsTxlengths = txInBucket0.merge(txInBucket1).merge(txInBucket2);
// print(txInBucket0, 'txInBucket0');
// print(txInBucket1, 'txInBucket1');
// print(txInBucket2, 'txInBucket2');

// Organize tx locs by their perp dirs -- in prep for map() over dirs
var flowDirsFC = ee.FeatureCollection(flowDirDeg.map(function(l) {
  var dir = ee.Number(l);
  return ee.Feature(null, {dir: dir});
})).aside(print, 'flowDirsFC');

// var dirMatchingFilt = ee.Filter.equals({leftField: 'dir', rightField: 'perpFlow1'});
var dirMatchingFilt = ee.Filter.or(
  ee.Filter.equals({leftField: 'dir', rightField: 'perpFlow1'}),
  ee.Filter.equals({leftField: 'dir', rightField: 'perpFlow2'})
);

// Out of memory error when I tried to run for all of mainland India.
// Hence, breaking it up state-wise
var filename = 'txs';
var stateNamesWithTxs = indiaStates.filterBounds(riverPointsMinDistApart)
  .aggregate_array('ST_NM').getInfo();
for (var i = 0; i < stateNamesWithTxs.length; i++) {
  var st = ee.Feature(indiaStates.filter(ee.Filter.eq("ST_NM", stateNamesWithTxs[i])).union(50).first());
  var pointsByDir = ee.Join.saveAll('points')
    .apply(flowDirsFC, txLocsWithDirsTxlengths.filterBounds(st.geometry()), dirMatchingFilt);
  // print(pointsByDir, 'pointsByDir');

  // var ans = drawTransect(ee.Feature(pointsByDir.first())).aside(print, 'ans');
  var allTxDrawnByLen = pointsByDir.map(drawTransect);
  var allTxDrawnByLen_projected = allTxDrawnByLen
    // mosaicing with or() yields result with no projection, so reproject in desired proj first
    .map(addProjToDummyResultIms)
    .flatten();
  var allTxDrawnCombined = ee.ImageCollection.fromImages(
    // WEIRD ALERT: allTxDrawnByLen_projected is a featurecollection of images, 
    // so turning it into a list and then an imagecollection, to do an or() on
    allTxDrawnByLen_projected.toList(allTxDrawnByLen_projected.size())
  ).or();
  // Map.addLayer(allTxDrawnCombined.select('chosenPoints'), {max: 1}, 'chosen points')
  
  // Make polygons of the drawn transects
  var biggestTxLen_supPix = ee.Number(txLengthsForBins.reduce(ee.Reducer.max())) // tx half-length, in #superpixels
    .multiply(2).add(1); // tx full length
  var allTxDrawnCombinedVec = allTxDrawnCombined.select('rasterTxs').gt(0).selfMask().reduceToVectors({
    geometry: roi.bounds().geometry(),
    scale: opRes,
    eightConnected: true,
    labelProperty: null,
    maxPixels: 1e13
  }).map(addTxIdPropFromCentroid)
    .filter(ee.Filter.lte('count', biggestTxLen_supPix)); // to drop txs that got merged and became longer by mistake
  
  Export.table.toAsset({
    collection: allTxDrawnCombinedVec.select(['txId', 'count'], ['txId', 'numSuperPixelsInTx'])
      .set({flowAccBinBoundaries: flowAccBinBoundaries, txLengthsForBins: txLengthsForBins}),
    description: filename + '_' + stateNamesWithTxs[i],
    assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/statewiseTxs/' + filename + '_' + stateNamesWithTxs[i],
  });
}

//////// MAP VIZs //////////////////////////////////////////////////////////////
Map.addLayer(flowAcc.gt(flowAccThresh).selfMask(), {min: 0, max: 1, palette: ['ffffff', 'e78ac3']}, 'flowAcc', false);
Map.addLayer(waterOcc, {min: 0, max: 100, palette: ['000000', '0000ff']}, 'water history', false);

// Map.addLayer(riverPointsMinDistApart, {}, 'min dist apart');

var allTxDrawnCombinedViz = allTxDrawnCombined;
Map.addLayer(allTxDrawnCombinedViz.select('rasterTxs').selfMask(), {min: 0, max: 1, palette: ['000000', 'ff0000']}, 'reallyAllTr im rasterTxs');
Map.addLayer(allTxDrawnCombinedViz.select('chosenPoints'), {}, 'reallyAllTr im chosenPoints');
Map.addLayer(allTxDrawnCombinedVec, {color: 'green'}, 'all tx fcs');

