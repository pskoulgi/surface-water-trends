// READ IN DATA ////////////////////////////////////////////////////////////////
var flowAcc = ee.Image("WWF/HydroSHEDS/15ACC");
var flowDir = ee.Image("WWF/HydroSHEDS/15DIR");
var waterOcc = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence');
var indiaMainland = ee.Feature(ee.FeatureCollection('users/pradeepkoulgi/indiaMainland').first());

// USER INPUTS ////////////////////////////////////////////////////////////////
var flowAccThresh = 5000;
var roi = indiaMainland.set('name', 'indiaMainland');

// BASIC INITIALIZATIONS //////////////////////////////////////////////////////
var flowAccProj = flowAcc.projection();
var flowAccNomScale = flowAccProj.nominalScale();
var waterOccProj = waterOcc.projection();
var waterOccNomScale = waterOccProj.nominalScale();
var opProj = waterOccProj;
var opRes = opProj.nominalScale();
var minDistBwTransects = flowAccNomScale.divide(100).ceil().multiply(100)
  .multiply(2);

// PROCESSING /////////////////////////////////////////////////////////////////
// Make an image where only on-river pixels are valid and all else is masked
// and extract those on-river pixels' lat-lon
var latlonOnRiver = ee.Image.pixelCoordinates(flowAccProj)
  .updateMask(flowAcc.gt(flowAccThresh));
var pixelsDict = latlonOnRiver.reduceRegion({
  reducer: ee.Reducer.toList(), 
  geometry: roi.geometry(), 
  scale: flowAccNomScale,
  maxPixels: 1e9
});

// Find directions perpendicular to flow, in degrees modulo 360
// This is a bit confusing, for more details see 
// https://groups.google.com/g/google-earth-engine-developers/c/vYCKO48lLbE/m/t2GdtJ6fBQAJ

// Deg values are 0-360: to allow for mod(360) arithmetic in next step, to allow for
// map()ing over tx directions (much more efficient) instead of each tx loc
var flowDirRaw = ee.List([  1,   2,   4,   8, 16,  32, 64, 128]);
var flowDirDeg = ee.List([180, 225, 270, 315,  0,  45, 90, 135]);

var flowDirDegRemappedTo4326 = flowDir.remap(flowDirRaw, flowDirDeg);
var flowDirPerp1 = flowDirDegRemappedTo4326.add(ee.Image( 90)).mod(ee.Image(360)).rename('perpFlow1');
var flowDirPerp2 = flowDirDegRemappedTo4326.add(ee.Image(270)).mod(ee.Image(360)).rename('perpFlow2');

// Bring together all data to be saved with each transect loc
var propsToSaveWithEachPoint = ee.Image.cat(flowAcc.rename('flowAccum'), flowDirPerp1, flowDirPerp2);

// Wrangle the pixels lat-lon into feature collection of points
var riverPoints = ee.FeatureCollection(
  ee.List(pixelsDict.get('x')).zip(ee.List(pixelsDict.get('y')))
    .map(function(xy) {
      var pt = ee.Geometry.Point(ee.List(xy), flowAccProj);
      var propsOfPt = propsToSaveWithEachPoint.reduceRegion(ee.Reducer.first(), pt, flowAccNomScale);
      return ee.Feature(pt, propsOfPt);
    })
).set('flowAccThresh', flowAccThresh);
// print(riverPoints, 'riverPoints');

// Drop points that are too close together.
// Refer: https://groups.google.com/g/google-earth-engine-developers/c/ECV8ce6jseI/m/_RRkmdhuAwAJ

// Sift the points so that no two are two close together
var distFilter = ee.Filter.and(
  ee.Filter.withinDistance({
    distance: minDistBwTransects,
    leftField: '.geo',
    rightField: '.geo',
    maxError: 1
  }),
  ee.Filter.notEquals({
    leftField: 'system:index',
    rightField: 'system:index',
  })
);
var distSaveAll = ee.Join.saveAll({matchesKey: 'points', measureKey: 'distance'});
var spatialJoined = distSaveAll.apply(riverPoints, riverPoints, distFilter);

// Iteratively drop points that are too close to another point
var unpack = function(l) {
  return ee.List(l).map(function(f) {return ee.Feature(f).id()});
};
var ids = spatialJoined.iterate(
  function(f, list) {
    var key = ee.Feature(f).id();
    list = ee.Algorithms.If(
      ee.List(list).contains(key), // is f "within distance" of any point?
      list, // yes: make no change to list
      ee.List(list).cat(unpack(ee.List(f.get('points')))) // no: add all its "within distance" points to the list
    );
    return list;
  },
  ee.List([])
);
// print("Removal candidates' IDs", ids);
// print("Removal candidates' IDs", ee.List(ids).distinct());

// Clean up 
var riverPointsMinDistApart = riverPoints.filter(ee.Filter.inList('system:index', ids).not())
  .set('flowAccThresh', flowAccThresh);
// print(riverPointsMinDistApart, 'riverPointsMinDistApart');

// EXPORT ////////////////////////////////////////////////////////////////////
var filename = roi.getString('name').getInfo();
Export.table.toAsset({
  collection: riverPointsMinDistApart,
  description: filename + '_txLocsWithDirs',
  assetId: 'users/pradeepkoulgi/RiverChanges/publishV1/' + filename + '_txLocsWithDirs'
});

// MAP DISPLAYS //////////////////////////////////////////////////////////////
Map.centerObject(roi);
Map.addLayer(latlonOnRiver.clip(roi), {}, 'latlon');
Map.addLayer(riverPoints, {color: 'red'}, 'all pixs');
Map.addLayer(riverPointsMinDistApart, {}, 'min dist apart');

