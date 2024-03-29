/**
 Template Controllers

 @module Templates
 */

var setWindowSize = function (template) {
    Tracker.afterFlush(function () {
        ipc.send('backendAction_setWindowSize', 580, template.$('.popup-windows .inner-container').height() + 240);
    });
};


var defaultEstimateGas = 50000000;

/**
 The sendTransaction confirmation popup window template

 @class [template] popupWindows_sendTransactionConfirmation
 @constructor
 */


/**
 Takes a 4-byte function signature and does a best-effort conversion to a
 human readable text signature.

 @method (lookupFunctionSignature)
 */
var lookupFunctionSignature = function (data, remoteLookup) {
    return new Q(function (resolve, reject) {
        if (data && data.length > 8) {
            var bytesSignature = (data.substr(0, 2) === '0x')
                ? data.substr(0, 10)
                : '0x' + data.substr(0, 8);

            if (remoteLookup) {
                https.get('https://www.4byte.directory/api/v1/signatures/?hex_signature=' + bytesSignature, function (response) {
                    var body = '';

                    response.on('data', function (chunk) {
                        body += chunk;
                    });

                    response.on('end', function () {
                        var responseData = JSON.parse(body);
                        if (responseData.results.length) {
                            resolve(responseData.results[0].text_signature);
                        } else {
                            resolve(bytesSignature);
                        }
                    });
                }).on('error', function (error) {
                    console.warn('Error querying Function Signature Registry.', err);
                    reject(bytesSignature);
                });
            } else if (_.first(window.SIGNATURES[bytesSignature])) {
                resolve(_.first(window.SIGNATURES[bytesSignature]));
            } else {
                reject(bytesSignature);
            }
        } else {
            reject(undefined);
        }
    });
};

var localSignatureLookup = function (data) {
    return lookupFunctionSignature(data, false);
};

var remoteSignatureLookup = function (data) {
    return lookupFunctionSignature(data, true);
};

var signatureLookupCallback = function (textSignature) {
    // Clean version of function signature. Striping params
    TemplateVar.set(template, 'executionFunction', textSignature.replace(/\(.+$/g, ''));
    TemplateVar.set(template, 'hasSignature', true);

    var params = textSignature.match(/\((.+)\)/i);
    if (params) {
        console.log('params sent', params);
        TemplateVar.set(template, 'executionFunctionParamTypes', params);
        ipc.send('backendAction_decodeFunctionSignature', textSignature, data.data);
    }
};


Template['popupWindows_sendTransactionConfirmation'].onCreated(function () {
    var template = this;

    ipc.on('uiAction_decodedFunctionSignatures', function (event, params) {
        console.log('params returned', params);
        TemplateVar.set(template, 'params', params);
    });

    // check reactively if provided gas is enough
    this.autorun(function () {
        if (TemplateVar.get('estimatedGas') > Number(TemplateVar.get('providedGas'))) {
            TemplateVar.set('gasError', 'notEnoughGas');
        } else if (TemplateVar.get('estimatedGas') > 4000000) {
            TemplateVar.set('gasError', 'overBlockGasLimit');
        } else {
            TemplateVar.set('gasError', null);
        }
    });


    // check inital data and gas estimates
    this.autorun(function () {
        TemplateVar.set(template, 'displayDecodedParams', true);

        var data = Session.get('data');

        if (data) {


            // set window size
            setWindowSize(template);

            // set provided gas to templateVar
            TemplateVar.set('providedGas', data.gas || 0);
            TemplateVar.set('initialProvidedGas', data.gas || 0);

            // add gasPrice if not set
            if (!data.gasPrice) {
                web3.eth.getGasPrice(function (e, res) {
                    if (!e) {
                        data.gasPrice = '0x' + res.toString(16);
                        Session.set('data', data);
                    }
                });
            }

            // check if to is a contract
            if (data.to) {
                web3.eth.getCode(data.to, function (e, res) {
                    if (!e && res && res.length > 2) {
                        TemplateVar.set(template, 'toIsContract', true);
                        setWindowSize(template);
                    }
                });

                if (data.data) {
                    localSignatureLookup(data.data).then(function (textSignature) {
                        // Clean version of function signature. Striping params
                        TemplateVar.set(template, 'executionFunction', textSignature.replace(/\(.+$/g, ''));
                        TemplateVar.set(template, 'hasSignature', true);

                        var params = textSignature.match(/\((.+)\)/i);
                        if (params) {
                            TemplateVar.set(template, 'executionFunctionParamTypes', params);
                            ipc.send('backendAction_decodeFunctionSignature', textSignature, data.data);
                        }
                    }).catch(function (bytesSignature) {
                        TemplateVar.set(template, 'executionFunction', bytesSignature);
                        TemplateVar.set(template, 'hasSignature', false);
                    });
                }
            }
            if (data.from) {
                web3.eth.getCode(data.from, function (e, res) {
                    if (!e && res && res.length > 2) {
                        TemplateVar.set(template, 'fromIsContract', true);
                    }
                });
            }

            // estimate gas usage
            var estimateData = _.clone(data);
            estimateData.gas = defaultEstimateGas;
            web3.eth.estimateGas(estimateData, function (e, res) {
                console.log('Estimated gas: ', res, e);
                if (!e && res) {

                    // set the gas to the estimation, if not provided or lower
                    Tracker.nonreactive(function () {
                        var gas = Number(TemplateVar.get(template, 'providedGas'));

                        if (res === defaultEstimateGas) {
                            return TemplateVar.set(template, 'estimatedGas', 'invalid');
                        }

                        TemplateVar.set(template, 'estimatedGas', res);


                        if (!gas && res) {
                            TemplateVar.set(template, 'providedGas', res + 100000);
                            TemplateVar.set(template, 'initialProvidedGas', res + 100000);
                        }
                    });
                }
            });
        }
    });
});

Template['popupWindows_sendTransactionConfirmation'].onRendered(function () {
    var template = this;

    Meteor.setTimeout(function () {
        template.$('input[type="password"]').focus();
    }, 200);
});

Template['popupWindows_sendTransactionConfirmation'].helpers({
    /**
     Returns the total amount

     @method (totalAmount)
     */
    'totalAmount': function () {
        var amount = EthTools.formatBalance(this.value, '0,0.00[0000000000000000]', 'ether');
        var dotPos = (~amount.indexOf('.')) ? amount.indexOf('.') + 3 : amount.indexOf(',') + 3;

        return amount ? amount.substr(0, dotPos) + '<small style="font-size: 0.5em;">' + amount.substr(dotPos) + '</small>' : '0';
    },
    /**
     Calculates the fee used for this transaction in ether

     @method (estimatedFee)
     */
    'estimatedFee': function () {
        var gas = TemplateVar.get('estimatedGas');
        if (gas && this.gasPrice) {
            return EthTools.formatBalance(new BigNumber(gas, 10).times(new BigNumber(this.gasPrice, 10)), '0,0.0[0000000] unit', 'ether');
        }
    },
    /**
     Calculates the provided gas amount in ether

     @method (providedGas)
     */
    'providedGas': function () {
        var gas = TemplateVar.get('providedGas');
        if (gas && this.gasPrice) {
            return EthTools.formatBalance(new BigNumber(gas, 10).times(new BigNumber(this.gasPrice, 10)), '0,0.0[0000000]', 'ether');
        }
    },
    /**
     Shortens the address to 0xffff...ffff

     @method (shortenAddress)
     */
    'shortenAddress': function (address) {
        if (_.isString(address)) {
            return address.substr(0, 6) + '...' + address.substr(-4);
        }
    },
    /**
     Formats the data so that all zeros are wrapped in span.zero

     @method (formattedData)
     */
    'formattedData': function () {
        return (TemplateVar.get('toIsContract'))
            ? this.data.replace(/([0]{2,})/g, '<span class="zero">$1</span>').replace(/(0x[a-f0-9]{8})/i, '<span class="function">$1</span>')
            : this.data.replace(/([0]{2,})/g, '<span class="zero">$1</span>');
    },

    'params': function () {
        return TemplateVar.get('params');
    },
    /**
     Formats parameters

     @method (showFormattedParams)
     */
    'showFormattedParams': function () {
        return TemplateVar.get('params') && TemplateVar.get('displayDecodedParams');
    },
    /**
     Checks if transaction will be invalid

     @method (transactionInvalid)
     */
    'transactionInvalid': function () {
        return TemplateVar.get('estimatedGas') === 'invalid'
            || TemplateVar.get('estimatedGas') === 0
            || typeof TemplateVar.get('estimatedGas') === 'undefined';
    },
    /**
     Clear amount from characters

     @method (clearAmountFromChars)
     */
    'clearUnitChars' : function (amount) {
        // window.alert(amount)
        amount = (~amount.indexOf('.'))
            ? amount.replace(/\,/g, '')
            : amount;

        return amount.replace(/ether/g, '');

    }
});
Template.__checkName("icube_identicon_send");
Template["icube_identicon_send"] = new Template("Template.icube_identicon_send", (function() {
    var view = this;
    return Blaze.If(function() {
        return Spacebars.call(view.lookup("identity"));
    }, function() {
        return [ "\n        ", Blaze.If(function() {
            return Spacebars.call(view.lookup("link"));
        }, function() {
            return [ "\n            ", HTML.A({
                href: function() {
                    return Spacebars.mustache(view.lookup("link"));
                },
                class: function() {
                    return [ "dapp-identicon ", Spacebars.mustache(view.lookup("class")) ];
                },
                style: function() {
                    return [ "background-image: url('", Spacebars.mustache(view.lookup("identiconData"), view.lookup("identity")), "')" ];
                },
                title: function() {
                    return Spacebars.mustache(view.lookup("i18nTextIcon"));
                }
            }), "\n        " ];
        }, function() {
            var imgPath = window.parseInt(Spacebars.call(view.lookup("identity")),16)%30;
            // window.alert(imgPath);
            return [ "\n            ", HTML.SPAN({
                class: function() {
                    return [ "dapp-identicon ", Spacebars.mustache(view.lookup("class")), " img",imgPath,""];
                },
                style: function() {
                    // return [ "background-image: url('../../images/", imgPath, ".png')" ];
                    // return [ "background-image: url('", Spacebars.mustache(view.lookup("identiconData"), view.lookup("identity")), "')" ];
                },
                title: function() {
                    return Spacebars.mustache(view.lookup("i18nTextIcon"));
                }
            }), "\n        " ];
        }), "\n    " ];
    });
}));

/**
 The cached identicons
 @property cache
 */
var cache = {};

Template['icube_identicon_send'].helpers({
    /**
     Make sure the identity is lowercased
     @method (identity)
     */
    'identity': function(identity){
        return (_.isString(this.identity)) ? this.identity.toLowerCase() : this.identity;
    },
    /**
     Return the cached or generated identicon
     @method (identiconData)
     */
    'identiconData': function(identity){
        // remove items if the cache is larger than 50 entries
        if(_.size(cache) > 50) {
            delete cache[Object.keys(cache)[0]];
        }

        return cache['ID_'+ identity] || (cache['ID_'+ identity] =  blockies.create({
            seed: identity,
            size: 8,
            scale: 8
        }).toDataURL());
    },
    /**
     Get the correct text, if TAPi18n is available.
     @method i18nText
     */
    'i18nTextIcon': function(){
        if(typeof TAPi18n === 'undefined' || TAPi18n.__('elements.identiconHelper') == 'elements.identiconHelper') {
            return "This is a security icon, if there's any change on the address the resulting icon should be a completelly different one";
        } else {
            return TAPi18n.__('elements.identiconHelper');
        }
    }
});

Template['popupWindows_sendTransactionConfirmation'].events({
    /**
     Gets the new provided gas in ether amount and calculates the resulting providedGas

     @event change .provided-gas, input .provided-gas
     */
    'change .provided-gas, input .provided-gas': function (e, template) {
        var gas = template.$('.provided-gas').text().replace(/[, ]+/g, '');// template.$('.provided-gas').text();

        TemplateVar.set('providedGas', gas);
    },
    /**
     Increase the estimated gas

     @event click .not-enough-gas
     */
    'click .not-enough-gas': function () {
        var gas = Number(TemplateVar.get('estimatedGas')) + 100000;
        TemplateVar.set('initialProvidedGas', gas);
        TemplateVar.set('providedGas', gas);
    },
    /**
     Cancel the transaction confirmation and close the popup

     @event click .cancel
     */
    'click .cancel': function () {
        ipc.send('backendAction_unlockedAccountAndSentTransaction', 'Transaction not confirmed');
        ipc.send('backendAction_closePopupWindow');
    },
    /**
     Confirm the transaction

     @event submit form
     */
    'submit form': function (e, template) {
        e.preventDefault();

        var data = Session.get('data'),
            pw = template.find('input[type="password"]').value,
            gas = web3.fromDecimal(TemplateVar.get('providedGas'));

        // check if account is about to send to itself
        if (data.to && data.from === data.to.toLowerCase()) {
            GlobalNotification.warning({
                content: TAPi18n.__('mist.popupWindows.sendTransactionConfirmation.errors.sameAccount'),
                duration: 5
            });

            return false;
        }

        console.log('Choosen Gas: ', gas, TemplateVar.get('providedGas'));

        if (!gas || !_.isFinite(gas)) {
            return;
        } else {
            data.gas = gas;
        }

        TemplateVar.set('unlocking', true);

        // unlock and send transaction!
        web3.personal.sendTransaction(data, pw || '', function (e, res) {
            pw = null;
            TemplateVar.set(template, 'unlocking', false);

            if (!e && res) {
                ipc.send('backendAction_unlockedAccountAndSentTransaction', null, res);

            } else {
                Tracker.afterFlush(function () {
                    template.find('input[type="password"]').value = '';
                    template.$('input[type="password"]').focus();
                });
                if (e.message.indexOf('Unable to connect to socket: timeout') !== -1) {
                    GlobalNotification.warning({
                        content: TAPi18n.__('mist.popupWindows.sendTransactionConfirmation.errors.connectionTimeout'),
                        duration: 5
                    });
                } else if (e.message.indexOf('could not decrypt key with given passphrase') !== -1) {
                    GlobalNotification.warning({
                        content: TAPi18n.__('mist.popupWindows.sendTransactionConfirmation.errors.wrongPassword'),
                        duration: 3
                    });
                } else if (e.message.indexOf('multiple keys match address') !== -1) {
                    GlobalNotification.warning({
                        content: TAPi18n.__('mist.popupWindows.sendTransactionConfirmation.errors.multipleKeysMatchAddress'),
                        duration: 10
                    });
                } else if (e.message.indexOf('Insufficient funds for gas * price + value') !== -1) {
                    GlobalNotification.warning({
                        content: TAPi18n.__('mist.popupWindows.sendTransactionConfirmation.errors.insufficientFundsForGas'),
                        duration: 5
                    });
                } else {
                    GlobalNotification.warning({
                        content: e.message,
                        duration: 5
                    });
                }
            }
        });
    },

    'click .data .toggle-panel': function () {
        TemplateVar.set('displayDecodedParams', true);
    },
    'click .parameters .toggle-panel': function () {
        TemplateVar.set('displayDecodedParams', false);
    },
    'click .lookup-function-signature': function (e, template) {
        var data = Session.get('data');
        TemplateVar.set('lookingUpFunctionSignature', true);

        remoteSignatureLookup(data.data).then(function (textSignature) {
            TemplateVar.set(template, 'lookingUpFunctionSignature', false);

            // Clean version of function signature. Striping params
            TemplateVar.set(template, 'executionFunction', textSignature.replace(/\(.+$/g, ''));
            TemplateVar.set(template, 'hasSignature', true);

            var params = textSignature.match(/\((.+)\)/i);
            if (params) {
                console.log('params:', params);
                TemplateVar.set(template, 'executionFunctionParamTypes', params);
                ipc.send('backendAction_decodeFunctionSignature', textSignature, data.data);
            }
        }).catch(function (bytesSignature) {
            TemplateVar.set(template, 'lookingUpFunctionSignature', false);
            TemplateVar.set(template, 'executionFunction', bytesSignature);
            TemplateVar.set(template, 'hasSignature', false);
        });
    }
});
