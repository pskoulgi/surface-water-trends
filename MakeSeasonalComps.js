/* FUNCTIONS *********************************************/

// Combines a season's worth of monthly water occurrence to a 
// single snapshot for the season.
// coll should contain 3 months of images, for which the 
// combining logic has been thought up/designed.
var seasonalComposite = function(coll) {
  coll = ee.ImageCollection(coll);
  
  // Build masks separately for each pixClass
  var seasNodata = coll.map(function(im) {return im.unmask(pixClassValues.nodata, false).eq(pixClassValues.nodata)})
    .and(); // "always nodata"; 1 if all 3 are nodata, 0 else
  var seasNotwater = coll.map(function(im) {return im.unmask(pixClassValues.nodata, false).neq(pixClassValues.water)})
    .and()  // 1 if never water, 0 else
    .and(seasNodata.not()); // "not always nodata, never water"
  var seasWater = coll.map(function(im) {return im.unmask(pixClassValues.nodata, false).eq(pixClassValues.water)})
    .or();  // "any water"; 1 if any of 3 is water, 0 else
  
  // Assign values to each pixClass using the masks, combine into a single image
  var seasCompos = seasNodata.multiply(ee.Image(pixClassValues.nodata))
    .add(seasNotwater.multiply(ee.Image(pixClassValues.notwater)))
    .add(seasWater.multiply(ee.Image(pixClassValues.water)));
  
  return seasCompos;
};

/* INITIALIZATIONS ****************************************/ 

var indiaMainlandWithBuff = ee.Feature(ee.FeatureCollection('users/pradeepkoulgi/indiaMainland').first())
  .simplify(5e3)
  .aside(Map.addLayer, {}, 'India simplified boundary')
  .buffer(150e3, 100)
  .aside(Map.addLayer, {}, 'India buffered boundary - roi');

var waterHistoryYearStart = 1991;
var waterHistoryYearEnd   = 2021;
var monthlyWater = ee.ImageCollection("JRC/GSW1_4/MonthlyHistory")
  .filterDate(waterHistoryYearStart.toString() + '-01-01', waterHistoryYearEnd.toString() + '-12-31');

var pixClassValues = {nodata: 0, notwater: 1, water: 2};
var pixClassLabels = ee.List(Object.keys(pixClassValues));

var monsoonYearStartMonth = 6; // Jun. Count year as Jun-May
// Set season start months. Season length is taken as 3 months from these.
var drySeasMonthsOffset = 8;   // Feb: Jun+8
var drySeasMonthsTag = '_fma';
var wetSeasMonthsOffset = 4;   // Oct: Jun+4
var wetSeasMonthsTag = '_ond';

/* PROCESSING *******************************************/ 

var seasonalWater = monthlyWater
  .filterMetadata('year', 'less_than', waterHistoryYearEnd) // waterHistoryYearEnd year won't get its summer comp
  .distinct('year')
  // Calculate seasonal composites from monthly data
  .map(function(im) {
    var y = im.getNumber('year');
    var yMonsoonSeasStart = ee.Date.fromYMD(y, monsoonYearStartMonth, 1);
    
    var imYearDrySeasColl = monthlyWater.filterDate(
      yMonsoonSeasStart.advance(drySeasMonthsOffset,     'month'),
      yMonsoonSeasStart.advance(drySeasMonthsOffset + 3, 'month')
    );
    var yearDryCompos = seasonalComposite(imYearDrySeasColl)
      .rename('drySeasCompos' + drySeasMonthsTag);
    
    var imYearWetSeasColl = monthlyWater.filterDate(
      yMonsoonSeasStart.advance(wetSeasMonthsOffset,     'month'),
      yMonsoonSeasStart.advance(wetSeasMonthsOffset + 3, 'month')
    );
    var yearWetCompos = seasonalComposite(imYearWetSeasColl)
      .rename('wetSeasCompos' + wetSeasMonthsTag);
    
    // Calculate [nodata, notwater, water] pixels for "both seasons" (dry & wet),
    // i.e., "permanent water" composite
  
    // Combinations of valid data (water, notwater)
    var waterDryNotwaterWet    = yearDryCompos.eq(pixClassValues.water)
      .and(yearWetCompos.eq(pixClassValues.notwater))
      .rename('waterDryNotwaterWet');    // water in dry season only
    var notwaterDryWaterWet    = yearDryCompos.eq(pixClassValues.notwater)
      .and(yearWetCompos.eq(pixClassValues.water))
      .rename('notwaterDryWaterWet');    // water in wet season only
    var waterDryWaterWet       = yearDryCompos.eq(pixClassValues.water)
      .and(yearWetCompos.eq(pixClassValues.water))
      .rename('waterDryWaterWet');       // water in both seasons
    var notwaterDryNotwaterWet = yearDryCompos.eq(pixClassValues.notwater)
      .and(yearWetCompos.eq(pixClassValues.notwater))
      .rename('notwaterDryNotwaterWet'); // water in neither seasons
    
    // Rest of the combinations. Contains at least one nodata
    var waterDryNodataWet      = yearDryCompos.eq(pixClassValues.water)
      .and(yearWetCompos.eq(pixClassValues.nodata))
      .rename('waterDryNodataWet');
    var notwaterDryNodataWet   = yearDryCompos.eq(pixClassValues.notwater)
      .and(yearWetCompos.eq(pixClassValues.nodata))
      .rename('notwaterDryNodataWet');
    var nodataDryWaterWet      = yearDryCompos.eq(pixClassValues.nodata)
      .and(yearWetCompos.eq(pixClassValues.water))
      .rename('nodataDryWaterWet');
    var nodataDryNotwaterWet   = yearDryCompos.eq(pixClassValues.nodata)
      .and(yearWetCompos.eq(pixClassValues.notwater))
      .rename('nodataDryNotwaterWet');
    var nodataDryNodataWet    = yearDryCompos.eq(pixClassValues.nodata)
      .and(yearWetCompos.eq(pixClassValues.nodata))
      .rename('nodataDryNodataWet');

    var permWater    = waterDryWaterWet;
    var permNotwater = notwaterDryWaterWet.or(waterDryNotwaterWet).or(notwaterDryNotwaterWet);
    var permNodata   = waterDryNodataWet.or(notwaterDryNodataWet)
      .or(nodataDryWaterWet).or(nodataDryNotwaterWet)
      .or(nodataDryNodataWet);
    var yearPermCompos = permNodata.multiply(ee.Image(pixClassValues.nodata))
    .add(permNotwater.multiply(ee.Image(pixClassValues.notwater)))
    .add(permWater   .multiply(ee.Image(pixClassValues.water)))
    .rename('prmSeasCompos_DnW');

    var seasonalCompos = ee.Image.cat([yearDryCompos, yearWetCompos, yearPermCompos])
      .set({
        // save each season's months info with the image.
        // don't know how to do this at the collection-level
        monsoonYearStartMonth: monsoonYearStartMonth,
        drySeasMonthsOffset  : drySeasMonthsOffset,
        drySeasMonthsTag     : drySeasMonthsTag,
        wetSeasMonthsOffset  : wetSeasMonthsOffset,
        wetSeasMonthsTag     : wetSeasMonthsTag
      })
      .set('system:time_start', yMonsoonSeasStart.millis())
      .copyProperties(im, ['year']);
    return im.set({seasonalCompos: seasonalCompos});
  })
  .aggregate_array('seasonalCompos');

var size = seasonalWater.size().getInfo();
for (var i = 0; i < size ; i++) {
    var image = ee.Image(seasonalWater.get(i));
    var imName = "seasonalWater" + (i+waterHistoryYearStart).toString();
    Export.image.toAsset({
        image: image.clip(indiaMainlandWithBuff),
        description: imName,
        assetId: "RiverChanges/publishV1/waterOccSeasComps/" + imName,
        region: indiaMainlandWithBuff.bounds(),
        scale: 30,
        pyramidingPolicy: {'.default': 'mode'},
        maxPixels: 1e13
    });
}

