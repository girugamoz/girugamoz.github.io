
function trimLines(lines) {
    return lines.map((line) => {
        return line.trim();
    }).filter((line) => !!line);
}

function writeArrayElementsToObject(array, keyAtttr, object) {
    array.forEach((element) => {
        if (element === null) {
            throw new Error('filter these out earlier, else it messes with stats');
        }
        var clone = Object.assign({}, element);
        var keyValue = clone[keyAtttr];
        delete clone[keyAtttr];
        object[keyValue] = clone;
    });
}

function objectKeysToArray(object, keyAttr) {
    return Object.keys(object).map((key) => {
        var elementClone = Object.assign({}, object[key]);
        elementClone[keyAttr] = key;
        return elementClone;
    });
}

function newStats() {
    return {
        'converted-on': null,
        sets: {
            input: 0,
            output: 0,
            skipped: 0
        },
        markers: {
            input: 0,
            output: 0,
            skipped: 0
        }
    };
}

function finalizeStats(stats) {
    //stats.sets.skipped = stats.sets.input - stats.sets.output;
    //stats.markers.skipped = stats.markers.input - stats.markers.output;
}

function formatStats(stats) {
    stats['converted-on'] = (new Date()).toLocaleString();

    var statsText = ('"conversion-result": ' + JSON.stringify(stats, null, 4))
        .split('\n')
        .map((line) => {
            return '#   ' + line
        })
        .join('\n');

    return statsText;
}

function parseInput(inputSource) {
    var input = jsyaml.load(inputSource);
    return input;
}

function convertColor(colorAsNumber, opacity) {
    var rgb = ((colorAsNumber) >>> 0).toString(16).slice(-6);
    opacity = typeof opacity === 'number' ? opacity : 1;

    var outputColor = {};
    outputColor.r = parseInt(rgb.slice(0, 2), 16);
    outputColor.g = parseInt(rgb.slice(2, 4), 16);
    outputColor.b = parseInt(rgb.slice(4, 6), 16);
    outputColor.a = opacity;

    return outputColor;
}

function convertCoordArrays(xArray, yArray, zArray) {
    var result = [];
    for (let idx = 0; idx < xArray.length; idx++) {
        var point = {};
        point.x = xArray[idx];
        if (yArray) {
            point.y = yArray[idx];
        }
        point.z = zArray[idx];
        result.push(point);
    }
    return result;
}

function convertSimpleMarker(inputMarker, state) {
    var outputMarker = {
        __marker_name__: inputMarker.__marker_name__,
        type: 'poi',
        position: {
            x: inputMarker.x,
            y: inputMarker.y,
            z: inputMarker.z
        },
        label: inputMarker.label
    };

    if (inputMarker.icon && inputMarker.icon !== 'default') {
        outputMarker.icon = state.options.convertIcon(inputMarker.icon);
    }

    return outputMarker;
}

function convertComplexMarker(inputMarker, outputMarkerType, state) {
    var outputMarker = {
        __marker_name__: inputMarker.__marker_name__,
        type: outputMarkerType
    }

    if (inputMarker.label) {
        outputMarker.label = inputMarker.label;
    }
    if (inputMarker.strokeWeight) {
        outputMarker['line-width'] = inputMarker.strokeWeight;
    }
    if (inputMarker.strokeColor) {
        outputMarker['line-color'] = convertColor(inputMarker.strokeColor, inputMarker.opacity);
    }
    if (inputMarker.fillColor) {
        outputMarker['fill-color'] = convertColor(inputMarker.fillColor, inputMarker.fillOpacity);
    }
    if (inputMarker.markup) {
        // TODO: what is this for? markup in label?
    }

    return outputMarker;
}

function convertLineMarker(inputMarker, state) {
    var outputMarker = convertComplexMarker(inputMarker, 'line', state);

    outputMarker.line = convertCoordArrays(inputMarker.x, inputMarker.y, inputMarker.z);
    outputMarker.position = outputMarker.line[0]; // TODO: does DynMap have a position for lines?

    return outputMarker;
}

function convertAreaMarker(inputMarker, state) {
    var outputMarkerType = inputMarker.ytop === inputMarker.ybottom ? 'shape' : 'extrude';
    var outputMarker = convertComplexMarker(inputMarker, outputMarkerType, state);

    outputMarker.shape = convertCoordArrays(inputMarker.x, null, inputMarker.z);
    outputMarker.position = outputMarker.shape[0]; // TODO: does DynMap have a position for areas?

    if (outputMarker.shape.length === 2) {
        // rectangle
        var p1 = outputMarker.shape[0];
        var p2 = outputMarker.shape[1];
        outputMarker.shape = [{
                x: p1.x,
                z: p1.z
            },
            {
                x: p2.x,
                z: p1.z
            },
            {
                x: p2.x,
                z: p2.z
            },
            {
                x: p1.x,
                z: p2.z
            }
        ];
    }

    if (outputMarkerType === 'shape') {
        outputMarker['shape-y'] = inputMarker.ytop;
    } else {
        outputMarker['shape-min-y'] = inputMarker.ybottom;
        outputMarker['shape-max-y'] = inputMarker.ytop;
    }

    return outputMarker;
}

function convertMarkerSet(inputSet, state) {
    var outputSet = {
        __set_name__: inputSet.__set_name__,
        label: inputSet.label,
        toggleable: true,
        'default-hidden': !!inputSet.hide, // TODO: wrong output attribute name? or ignored by BlueMap?
        markers: {}
    };

    Object.entries({
        'markers': convertSimpleMarker,
        'lines': convertLineMarker,
        'areas': convertAreaMarker
    }).forEach((entry) => {
        var inputMarkerCategory = entry[0];
        var markerConvertFunction = entry[1];
        var inputMarkerArray = objectKeysToArray(inputSet[inputMarkerCategory], '__marker_name__');
        var outputMarkerArray = inputMarkerArray
            .filter((marker) => {
                var isIncluded = state.options.isMatchingWorld(marker.world);
                if (!isIncluded) {
                    state.stats.markers.skipped++;
                }
                return isIncluded;
            })
            .map((marker) => {
                return markerConvertFunction(marker, state);
            })
            .filter((marker) => {
                return !!marker;
            });

        writeArrayElementsToObject(outputMarkerArray, '__marker_name__', outputSet.markers);
        state.stats.markers.input += inputMarkerArray.length;
        state.stats.markers.output += outputMarkerArray.length;
    });

    return outputSet;
}

function convertMarkerSets(inputSets, state) {
    var inputSetArray = objectKeysToArray(inputSets, '__set_name__');

    var outputSetArray = inputSetArray
        .filter((set) => {
        	var isIncluded = state.options.isSetIncluded(set.__set_name__);
            if (!isIncluded) {
            	state.stats.sets.skipped++;
            }
            return isIncluded;
        })
        .map((set) => {
            return convertMarkerSet(set, state);
        })
        .filter((set) => {
            return !!set;
        });

    state.stats.sets.input += inputSetArray.length;
    state.stats.sets.output += outputSetArray.length;
    return outputSetArray;
}

function convert(inputSource, options) {
    options.isMatchingWorld = function(worldName) {
        return !!this.worldName ? worldName === this.worldName : true;
    };
    options.isSetIncluded = function(setName) {
        return this.excludedSets.indexOf(setName) < 0;
    };
    options.convertIcon = function(icon) {
        return this.iconMapping.replace('%icon%', icon);
    };

    var state = {
    	options: options,
        stats: newStats()
    }

    var input = jsyaml.load(inputSource);

    var outputMarkerSetArray = convertMarkerSets(input.sets, state);
    var outputMarkerSets = {};
    writeArrayElementsToObject(outputMarkerSetArray, '__set_name__', outputMarkerSets);

    var outputSource = '"marker-sets": ' + JSON.stringify(outputMarkerSets, null, 4) + '\n';

    finalizeStats(state.stats);
    var statsText = formatStats(state.stats);
    outputSource += '\n' + statsText;

    return outputSource;
}

function httpGetAsync(url, callback) {
    var xmlHttp = new XMLHttpRequest();
    xmlHttp.onreadystatechange = function() {
        if (xmlHttp.readyState == 4 && xmlHttp.status == 200)
            callback(xmlHttp.responseText);
    }
    xmlHttp.open("GET", url, true); // true for asynchronous
    xmlHttp.send(null);
}

//
// BEGIN UI code
//

function loadOptions(ui) {
    return {
        worldName: ui.options.world.value,
        excludedSets: trimLines(ui.options.excludedSets.value.split('\n')),
        iconMapping: ui.options.iconMapping.value
    };
}

function convertButtonClick(ui) {
    var options = loadOptions(ui);
    var inputSource = ui.input.value;

    var outputSource = convert(inputSource, options);

    ui.outputEditor.setValue(outputSource);
}

document.addEventListener('DOMContentLoaded', function() {
    var ui = {
        input: document.querySelector('.input .source'),
        output: document.querySelector('.output .source'),
        options: {
            world: document.querySelector('.options .world'),
            excludedSets: document.querySelector('.options .excluded-sets'),
            iconMapping: document.querySelector('.options .icon-mapping')
        },
        convertButton: document.querySelector('#convert-button')
    };
    ui.inputEditor = CodeMirror.fromTextArea(ui.input, {
        lineNumbers: true,
        mode: 'text/x-yaml'
    });
    ui.outputEditor = CodeMirror.fromTextArea(ui.output, {
        lineNumbers: true,
        mode: {
            name: 'javascript',
            json: true
        }
    });

    httpGetAsync('./input-example.yml', function(data) {
        ui.inputEditor.setValue(data);
    });

    ui.convertButton.addEventListener('click', function() {
       	convertButtonClick(ui);
    });
});

//
// END UI code
//
