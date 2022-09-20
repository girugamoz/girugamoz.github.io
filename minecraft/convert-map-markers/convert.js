
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
        errors: [],
        warnings: [],
        sets: {
            input: 0,
            output: 0,
            skipped: 0
        },
        markers: {
            input: 0,
            output: 0,
            skipped: 0
        },
        'converted-on': null,
        'converted-by': 'https://girugamoz.github.io/minecraft/convert-map-markers/'
    };
}

function finalizeStats(stats) {
    stats['converted-on'] = (new Date()).toLocaleString();

    if (stats.errors.length === 0) {
        delete stats['errors'];
    }
    if (stats.warnings.length === 0) {
        delete stats['warnings'];
    }
}

function formatStats(stats) {
    var statsText = ('"conversion-result": ' + JSON.stringify(stats, null, 4))
        .split('\n')
        .map((line) => ('#   ' + line))
        .join('\n');

    return statsText;
}

function parseInput(inputText) {
    var input = jsyaml.load(inputText);
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

function checkMaxCoordDistance(markerName, position, state) {
    if (typeof state.options.warnMaxCoordinateDistance !== 'number') {
        return;
    }

    var warnDistance = state.options.warnMaxCoordinateDistance;
    var isWithinWarnDistance =
        (position.x < 0 ? -1 * position.x : position.x) <= warnDistance &&
        (position.y < 0 ? -1 * position.y : position.y) <= warnDistance &&
        (position.z < 0 ? -1 * position.z : position.z) <= warnDistance;
    if (isWithinWarnDistance) {
        return;
    }

    var warningMessage = 'Marker \'' + markerName + '\': ' +
        'position is outside of warning distance (' + warnDistance + '): ' +
        'x: ' + position.x + ', ' + 'y: ' + position.y + ', ' + 'z: ' + position.z;
    state.stats.warnings.push(warningMessage);
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


function createOutputMarker(inputMarker, outputMarkerType, state) {
    var outputMarker = {
        __marker_name__: inputMarker.__marker_name__,
        type: outputMarkerType
    }

    if (inputMarker.label) {
        outputMarker.label = inputMarker.label;
        if (state.options.appendMarkerNameToLabel) {
            outputMarker.label += ' (' + inputMarker.__marker_name__ + ')';
        }
    }

    return outputMarker;
}

function convertSimpleMarker(inputMarker, state) {
    var outputMarker = createOutputMarker(inputMarker, 'poi', state);
    var position = {
        x: inputMarker.x,
        y: inputMarker.y,
        z: inputMarker.z
    };

    checkMaxCoordDistance(outputMarker.__marker_name__, position, state);

    outputMarker.position = position;

    var inputIcon = state.defaultInputIcon;
    if (!!inputMarker.icon && inputMarker.icon !== 'default') {
        inputIcon = inputMarker.icon;
    }
    if (inputIcon) {
        outputMarker.icon = state.options.mapIconName(inputIcon);
        var iconAnchor = state.options.getIconAnchor(inputIcon);
        if (iconAnchor) {
            outputMarker.anchor = iconAnchor;
        }
    }

    return outputMarker;
}

function convertComplexMarker(inputMarker, outputMarkerType, state) {
    var outputMarker = createOutputMarker(inputMarker, outputMarkerType, state);

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

    if (outputMarker.label) {
        outputMarker.detail = outputMarker.label;
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
    var outputMarkerCount = 0;

    state.defaultInputIcon = !!inputSet.deficon ? inputSet.deficon : null;

    Object.entries({
        'markers': convertSimpleMarker,
        'lines': convertLineMarker,
        'areas': convertAreaMarker
    }).forEach((entry) => {
        var inputMarkerCategory = entry[0];
        var markerConvertFunction = entry[1];
        var existsMarkerCategory = typeof inputSet[inputMarkerCategory] !== 'undefined';
        if (!existsMarkerCategory) {
            return;
        }
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
        outputMarkerCount += outputMarkerArray.length;
    });

    state.defaultInputIcon = null;

    return outputMarkerCount > 0 ? outputSet : null;
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
    options.isMatchingWorld = function isMatchingWorld(worldName) {
        return !!this.worldName ? worldName === this.worldName : true;
    };
    options.isSetIncluded = function isSetIncluded(setName) {
        return this.excludedSets.indexOf(setName) < 0;
    };
    options.mapIconName = function mapIconName(inputIconName) {
        return this.iconMapping.replace('%icon%', inputIconName);
    };
    options.getIconAnchor = function getIconAnchor(inputIconName) {
        if (!inputIconName) {
            return null;
        }
        var anchor = this.iconAnchors[inputIconName] || this.iconAnchors['*'] || null;
        return !anchor ? null : {
            x: Math.round(anchor.x),
            y: Math.round(anchor.y)
        }
    };

    var state = {
    	options: options,
        defaultInputIcon: null,
        stats: newStats()
    }

    var input = jsyaml.load(inputSource);

    var outputMarkerSetArray = convertMarkerSets(input.sets, state);
    var outputMarkerSets = {};
    writeArrayElementsToObject(outputMarkerSetArray, '__set_name__', outputMarkerSets);

    var outputSource = '"marker-sets": ' + JSON.stringify(outputMarkerSets, null, 4) + '\n';

    finalizeStats(state.stats);
    var statsText = formatStats(state.stats);
    outputSource += '\n' + statsText + '\n';

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

function errorPropertyReplacer(key, value) {
    if (value instanceof Error) {
        var error = {};
        Object.getOwnPropertyNames(value).forEach(function (propName) {
            error[propName] = value[propName];
            if (propName === 'stack' && !!error[propName]) {
                error[propName] = error[propName].split('\n')
            }
        });
        return error;
    }
    return value;
}

function stringifyError(error) {
    return JSON.stringify(error, errorPropertyReplacer, 2);
}

//
// BEGIN UI code
//

function getJsonErrorPos(errorMessage) {
    if (!errorMessage) {
        return null;
    }

    var match = errorMessage.match(/in JSON at position ([0-9]+)/g);
    if (!match || !match.length) {
        return null;
    }

    var s = match[0];
    s = s.substring('in JSON at position '.length);
    var pos = parseInt(s);
    return Number.isNaN(pos) ? null : pos;
}

function loadOptions(ui) {
    var options = {
        worldName: ui.options.world.value,
        excludedSets: trimLines(ui.options.excludedSets.value.split('\n')),
        iconMapping: ui.options.iconMapping.value,
        appendMarkerNameToLabel: !!ui.options.appendMarkerNameToLabel.checked,
        warnMaxCoordinateDistance: 1000 * 1000 // disabled by anything that is not a number
    };

    try {
        options.iconAnchors = JSON.parse(ui.options.iconAnchorEditor.getValue()) || {};
    } catch (exception) {
        var errorMessage = 'Invalid icon anchor mapping: ' + stringifyError(exception);
        ui.outputEditor.setValue(errorMessage);

        var jsonErrorPos = getJsonErrorPos(errorMessage);
        if (jsonErrorPos) {
            var editorPos = ui.options.iconAnchorEditor.posFromIndex(jsonErrorPos);
            ui.options.iconAnchorEditor.setCursor(editorPos);
            ui.options.iconAnchorEditor.focus();
        }
        return null;
    }

    return options;
}

function convertButtonClick(ui) {
    var options = loadOptions(ui);
    if (!options) {
        return;
    }

    var inputText = ui.inputEditor.getValue();

    var outputText = convert(inputText, options);

    ui.outputEditor.setValue(outputText);
}

document.addEventListener('DOMContentLoaded', function() {
    var ui = {
        inputEditor: CodeMirror.fromTextArea(document.querySelector('.input .source'), {
            mode: 'text/x-yaml',
            lineNumbers: true
        }),
        outputEditor: CodeMirror.fromTextArea(document.querySelector('.output .source'), {
            mode: {
                name: 'javascript',
                json: true
            },
            lineNumbers: true
        }),
        options: {
            world: document.querySelector('.options .world'),
            excludedSets: document.querySelector('.options .excluded-sets'),
            iconMapping: document.querySelector('.options .icon-mapping'),
            iconAnchorEditor: CodeMirror.fromTextArea(document.querySelector('.options .icon-anchors'), {
                mode: {
                    name: 'javascript',
                    json: true
                },
                lineNumbers: true
            }),
            appendMarkerNameToLabel: document.querySelector('.options .append-marker-name-to-label'),
        },
        convertButton: document.querySelector('#convert-button')
    };

    httpGetAsync('./input-example.yml', function(data) {
        ui.inputEditor.setValue(data);
    });

    ui.convertButton.addEventListener('click', function() {
        try {
       	    convertButtonClick(ui);
        } catch (exception) {
            var isInputParseError = exception.name === 'YAMLException';
            var existsInputErrorLocation = !!exception.mark &&
                typeof exception.mark.line === 'number';

            var errorMessage = (isInputParseError ? 'Invalid input: ' : 'Error: ') +
                stringifyError(exception);
            ui.outputEditor.setValue(errorMessage);

            if (isInputParseError && existsInputErrorLocation) {
                ui.inputEditor.focus();
                ui.inputEditor.setCursor({
                    line: exception.mark.line,
                    ch: exception.mark.column
                });
                ui.inputEditor.scrollIntoView(null, 40);
            }

            if (!isInputParseError) {
                umami.trackEvent('convert-error', errorMessage);
            }
        }
    });
});

//
// END UI code
//
