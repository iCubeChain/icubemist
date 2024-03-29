const _ = require('underscore');
const builder = require('electron-builder');
const del = require('del');
const exec = require('child_process').exec;
const fs = require('fs');
const gulp = require('gulp');
const babel = require('gulp-babel');
const options = require('../gulpfile.js').options;
const path = require('path');
const Q = require('bluebird');
const shell = require('shelljs');
const version = require('../package.json').version;

const type = options.type;
const applicationName = (options.wallet) ? 'iCubeWallet' : 'iCubeSphere';

gulp.task('clean-dist', (cb) => {
    return del([
        `./dist_${type}/**/*`,
        './icubewallet'
    ], cb);
});


gulp.task('copy-app-source-files', () => {
    return gulp.src([
        'node_modules/**/*',
        '!node_modules/electron/',
        '!node_modules/electron/**/*',
        './clientBinaries.json',
        './tests/**/*.*',
        '!./tests/wallet/*',
        `./icons/${type}/*`,
        './sounds/*',
        './errorPages/*',
        'customProtocols.js'
    ], {
        base: './'
    })
    .pipe(gulp.dest(`./dist_${type}/app`));
});


gulp.task('transpile-main', () => {
    return gulp.src('./main.js')
        .pipe(babel({ presets: ['es2016-node5'] }))
        .pipe(gulp.dest(`./dist_${type}/app`));
});


gulp.task('transpile-modules', () => {
    return gulp.src('./modules/**')
        .pipe(babel({ presets: ['es2016-node5'] }))
        .pipe(gulp.dest(`./dist_${type}/app/modules`));
});


gulp.task('copy-build-folder-files', () => {
    return gulp.src([
        `./icons/${type}/*`,
        './interface/public/images/dmg-background.jpg'
    ])
    .pipe(gulp.dest(`./dist_${type}/build`));
});


gulp.task('switch-production', (cb) => {
    fs.writeFile(`./dist_${type}/app/config.json`, JSON.stringify({
        production: true,
        mode: type
    }), cb);
});


gulp.task('bundling-interface', (cb) => {
    const bundle = (additionalCommands) => {
        exec(`cd interface \
            && meteor-build-client ${path.join('..', `dist_${type}`, 'app', 'interface')} -p "" \
            ${additionalCommands}`,
        (err, stdout) => {
            console.log(stdout);
            cb(err);
        });
    };

    if (type === 'wallet') {
        if (options.walletSource !== 'remote') {
            console.log('Use local wallet at ../icubewallet/app');
            bundle(`&& cd ../../icubewallet/app \
                && meteor-build-client ../../icubemist/dist_${type}/app/interface/wallet -p ""`);
        } else {
            console.log(`Pulling https://github.com/ethereum/meteor-dapp-wallet/tree/${options.walletSource} "${options.walletSource}" branch...`);
            bundle(`&& cd ../dist_${type} \
                && git clone --depth 1 https://github.com/ethereum/meteor-dapp-wallet.git \
                && cd meteor-dapp-wallet/app \
                && meteor-build-client ../../app/interface/wallet -p "" \
                && cd ../../ \
                && rm -rf meteor-dapp-wallet`);
        }
    } else {
        bundle();
    }
});


gulp.task('copy-i18n', () => {
    return gulp.src([
        './interface/i18n/*.*',
        './interface/project-tap.i18n'
    ], {
        base: './'
    })
    .pipe(gulp.dest(`./dist_${type}/app`));
});


gulp.task('build-dist', (cb) => {
    let ltarget = ['dir'];
    let wtarget = ['dir'];
    let idmg = false;
    let mtarget = ['dir'];
    if (options.buildmode === 'rel') {
        ltarget = ['zip', 'deb', 'rpm'];
        wtarget = ['zip'];
        mtarget = ['zip', 'dmg'];
        idmg = {
            background: '../build/dmg-background.jpg',
            iconSize: 128,
            contents: [
                {
                    x: 441,
                    y: 448,
                    type: 'link',
                    path: '/Applications'
                },
                {
                    x: 441,
                    y: 142,
                    type: 'file'
                }
            ]
        };
    }
    const appPackageJson = _.extend({}, require('../package.json'), {  // eslint-disable-line global-require
        name: applicationName.replace(/\s/, ''),
        productName: applicationName,
        description: applicationName,
        homepage: 'https://github.com/ethereum/mist',
        build: {
            appId: `com.ethereum.${type}`,
            asar: true,
            directories: {
                buildResources: '../build',
                output: '../dist'
            },
            linux: {
                category: 'WebBrowser',
                target: ltarget
            },
            win: {
                target: wtarget
            },
            mac: {
                category: 'public.app-category.productivity',
                target: mtarget
            },
            dmg: idmg
        }
    });
    fs.writeFileSync(
        path.join(__dirname, `../dist_${type}`, 'app', 'package.json'),
        JSON.stringify(appPackageJson, null, 2), 'utf-8'
    );

    const targets = [];
    if (options.mac) targets.push(builder.Platform.MAC);
    if (options.win) targets.push(builder.Platform.WINDOWS);
    if (options.linux) targets.push(builder.Platform.LINUX);

    let barch = (options.buildmode === 'rel') ? 'all' : 'x64';

    builder.build({
        targets: builder.createTargets(targets, null, barch),
        projectDir: path.join(__dirname, `../dist_${type}`, 'app'),
        publish: 'never',
        config: {
            afterPack(params) {
                return Q.try(() => {
                    shell.cp(
                        [
                            path.join(__dirname, '..', 'LICENSE'),
                            path.join(__dirname, '..', 'README.md'),
                            path.join(__dirname, '..', 'AUTHORS')
                        ],
                        params.appOutDir
                    );
                });
            }
        }
    })
    .catch((err) => {
        throw new Error(err);
    })
    .finally(() => {
        cb();
    });
});


gulp.task('release-dist', (done) => {
    const distPath = path.join(__dirname, `../dist_${type}`, 'dist');
    const releasePath = path.join(__dirname, `../dist_${type}`, 'release');

    shell.rm('-rf', releasePath);
    shell.mkdir('-p', releasePath);

    const appNameHypen = applicationName.replace(/\s/, '-');
    const appNameNoSpace = applicationName.replace(/\s/, '');
    const versionDashed = version.replace(/\./g, '-');

    const cp = (inputPath, outputPath) => {
        console.info(`Copying from ${path.join(distPath, inputPath)} to ${path.join(releasePath, outputPath)}`);
        shell.cp(path.join(distPath, inputPath), path.join(releasePath, outputPath));
    };

    _.each(options.activePlatforms, (platform) => {
        switch (platform) { // eslint-disable-line default-case
        case 'win':
            cp(
                `${applicationName}-${version}-ia32-win.zip`, `${appNameHypen}-win32-${versionDashed}.zip`);
            cp(
                `${applicationName}-${version}-win.zip`, `${appNameHypen}-win64-${versionDashed}.zip`);
            break;
        case 'mac':
            cp(
                `${applicationName}-${version}.dmg`,
                `${appNameHypen}-macosx-${versionDashed}.dmg`);
            break;
        case 'linux':
            cp(
                `${appNameNoSpace}-${version}.i686.rpm`, `${appNameHypen}-linux32-${versionDashed}.rpm`);
            cp(
                `${appNameNoSpace}_${version}_i386.deb`, `${appNameHypen}-linux32-${versionDashed}.deb`);
            cp(
                `${appNameNoSpace}-${version}-ia32.zip`, `${appNameHypen}-linux32-${versionDashed}.zip`);
            cp(
                `${appNameNoSpace}-${version}.x86_64.rpm`, `${appNameHypen}-linux64-${versionDashed}.rpm`);
            cp(
                `${appNameNoSpace}_${version}_amd64.deb`, `${appNameHypen}-linux64-${versionDashed}.deb`);
            cp(
                `${appNameNoSpace}-${version}.zip`, `${appNameHypen}-linux64-${versionDashed}.zip`);
            break;
        }
    });

    done();
});


gulp.task('build-nsis', (cb) => {
    const typeString = `-DTYPE=${type}`;
    const appNameString = `-DAPPNAME=${applicationName.replace(/\s/, '-')}`;
    const versionParts = version.split('.');
    const versionString = `-DVERSIONMAJOR=${versionParts[0]} -DVERSIONMINOR=${versionParts[1]} -DVERSIONBUILD=${versionParts[2]}`;

    const cmdString = `makensis ${versionString} ${typeString} ${appNameString} scripts/windows-installer.nsi`;

    exec(cmdString, cb);
});
