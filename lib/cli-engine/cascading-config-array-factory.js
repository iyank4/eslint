/**
 * @fileoverview `CascadingConfigArrayFactory` class.
 *
 * `CascadingConfigArrayFactory` class has a responsibility:
 *
 * 1. Handles cascading of config files.
 *
 * It provies two methods:
 *
 * - `getConfigArrayForFile(filePath)`
 *     Get the corresponded configuration of a given file. This method doesn't
 *     throw even if the given file didn't exist.
 * - `clearCache()`
 *     Clear the internal cache. You have to call this method when
 *     `additionalPluginPool` was updated if `baseConfig` or `cliConfig` depends
 *     on the additional plugins. (`CLIEngine#addPlugin()` method calls this.)
 *
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

//------------------------------------------------------------------------------
// Requirements
//------------------------------------------------------------------------------

const os = require("os");
const path = require("path");
const { validateConfigArray } = require("../config/config-validator");
const { ConfigArrayFactory } = require("./config-array-factory");
const { ConfigDependency } = require("./config-array");
const loadRules = require("./load-rules");
const debug = require("debug")("eslint:cascading-config-array-factory");

// debug.enabled = true;

//------------------------------------------------------------------------------
// Helpers
//------------------------------------------------------------------------------

// For VSCode intellisense
/** @typedef {ReturnType<ConfigArrayFactory["create"]>} ConfigArray */

/**
 * @typedef {Object} CascadingConfigArrayFactoryOptions
 * @property {Map<string,Parser>} [additionalParserPool] The map for additional parsers.
 * @property {Map<string,Plugin>} [additionalPluginPool] The map for additional plugins.
 * @property {ConfigData} [baseConfig] The config by `baseConfig` option.
 * @property {ConfigData} [cliConfig] The config by CLI options. This is prior to regular config files.
 * @property {ConfigArrayFactory} [configArrayFactory] The factory for config arrays.
 * @property {string} [cwd] The base directory to start lookup.
 * @property {string[]} [rulePaths] The value of `--rulesdir` option.
 * @property {string} [specificConfigPath] The value of `--config` option.
 * @property {boolean} [useEslintrc] if `false` then it doesn't load config files.
 */

/**
 * @typedef {Object} CascadingConfigArrayFactoryInternalSlots
 * @property {ConfigArray} baseConfigArray The config array of `baseConfig` option.
 * @property {ConfigData} baseConfigData The config data of `baseConfig` option. This is used to reset `baseConfigArray`.
 * @property {ConfigArray} cliConfigArray The config array of CLI options.
 * @property {ConfigData} cliConfigData The config data of CLI options. This is used to reset `cliConfigArray`.
 * @property {ConfigArrayFactory} configArrayFactory The factory for config arrays.
 * @property {Map<string, ConfigArray>} configCache The cache from directory paths to config arrays.
 * @property {string} cwd The base directory to start lookup.
 * @property {WeakMap<ConfigArray, ConfigArray>} finalizeCache The cache from config arrays to finalized config arrays.
 * @property {string[]|null} rulePaths The value of `--rulesdir` option. This is used to reset `baseConfigArray`.
 * @property {string|null} specificConfigPath The value of `--config` option. This is used to reset `cliConfigArray`.
 * @property {boolean} useEslintrc if `false` then it doesn't load config files.
 */

/** @type {WeakMap<CascadingConfigArrayFactory, CascadingConfigArrayFactoryInternalSlots>} */
const internalSlotsMap = new WeakMap();

/**
 * Create the config array from `baseConfig` and `rulePaths`.
 * @param {CascadingConfigArrayFactoryInternalSlots} slots The slots.
 * @returns {ConfigArray} The config array of the base configs.
 */
function createBaseConfigArray({
    configArrayFactory,
    baseConfigData,
    rulePaths,
    cwd
}) {
    const baseConfigArray = configArrayFactory.create(
        baseConfigData,
        { name: "BaseConfig" }
    );

    if (rulePaths && rulePaths.length > 0) {

        /*
         * Load rules `--rulesdir` option as a pseudo plugin.
         * Use a pseudo plugin to define rules of `--rulesdir`, so we can
         * validate the rule's options with only information in the config
         * array.
         */
        baseConfigArray.push({
            name: "--rulesdir",
            filePath: "",
            plugins: {
                "": new ConfigDependency({
                    definition: {
                        rules: rulePaths.reduce(
                            (map, rulesPath) => Object.assign(
                                map,
                                loadRules(rulesPath, cwd)
                            ),
                            {}
                        )
                    },
                    filePath: "",
                    id: "",
                    importerName: "--rulesdir",
                    importerPath: ""
                })
            }
        });
    }

    return baseConfigArray;
}

/**
 * Create the config array from CLI options.
 * @param {CascadingConfigArrayFactoryInternalSlots} slots The slots.
 * @returns {ConfigArray} The config array of the base configs.
 */
function createCLIConfigArray({
    cliConfigData,
    configArrayFactory,
    specificConfigPath
}) {
    const cliConfigArray = configArrayFactory.create(
        cliConfigData,
        { name: "CLIOptions" }
    );

    if (specificConfigPath) {
        cliConfigArray.unshift(
            ...configArrayFactory.loadFile(
                specificConfigPath,
                { name: "--config" }
            )
        );
    }

    return cliConfigArray;
}

/**
 * The error type when there are files matched by a glob, but all of them have been ignored.
 */
class ConfigurationNotFoundError extends Error {

    /**
     * @param {string} directoryPath - The directory path.
     */
    constructor(directoryPath) {
        super(`No ESLint configuration found on ${directoryPath}.`);
        this.messageTemplate = "no-config-found";
        this.messageData = { directoryPath };
    }
}

/**
 * This class provides the functionality that enumerates every file which is
 * matched by given glob patterns and that configuration.
 */
class CascadingConfigArrayFactory {

    /**
     * Initialize this enumerator.
     * @param {CascadingConfigArrayFactoryOptions} options The options.
     */
    constructor({
        additionalParserPool = new Map(),
        additionalPluginPool = new Map(),
        baseConfig: baseConfigData = null,
        cliConfig: cliConfigData = null,
        cwd = process.cwd(),
        rulePaths = [],
        specificConfigPath = null,
        useEslintrc = true
    } = {}) {
        const configArrayFactory = new ConfigArrayFactory({
            additionalParserPool,
            additionalPluginPool,
            cwd
        });

        internalSlotsMap.set(this, {
            baseConfigArray: createBaseConfigArray({
                baseConfigData,
                configArrayFactory,
                cwd,
                rulePaths
            }),
            baseConfigData,
            cliConfigArray: createCLIConfigArray({
                cliConfigData,
                configArrayFactory,
                specificConfigPath
            }),
            cliConfigData,
            configArrayFactory,
            configCache: new Map(),
            cwd,
            finalizeCache: new WeakMap(),
            rulePaths,
            specificConfigPath,
            useEslintrc
        });
    }

    /**
     * The path to the current working directory.
     * This is used by tests.
     * @type {string}
     */
    get cwd() {
        const { cwd } = internalSlotsMap.get(this);

        return cwd;
    }

    /**
     * Get the config array of a given file.
     * @param {string} [filePath] The file path to a file.
     * @returns {ConfigArray} The config array of the file.
     */
    getConfigArrayForFile(filePath = "a.js") {
        const { cwd } = internalSlotsMap.get(this);
        const directoryPath = path.dirname(path.resolve(cwd, filePath));

        debug(`Load config files for ${directoryPath}.`);

        return this._finalizeConfigArray(
            this._loadConfigInAncestors(directoryPath),
            directoryPath
        );
    }

    /**
     * Clear config cache.
     * @returns {void}
     */
    clearCache() {
        const slots = internalSlotsMap.get(this);

        slots.baseConfigArray = createBaseConfigArray(slots);
        slots.cliConfigArray = createCLIConfigArray(slots);
        slots.configCache.clear();
    }

    /**
     * Load and normalize config files from the ancestor directories.
     * @param {string} directoryPath The path to a leaf directory.
     * @returns {ConfigArray} The loaded config.
     * @private
     */
    _loadConfigInAncestors(directoryPath) {
        const {
            baseConfigArray,
            configArrayFactory,
            configCache,
            cwd,
            useEslintrc
        } = internalSlotsMap.get(this);

        if (!useEslintrc) {
            return baseConfigArray;
        }

        let configArray = configCache.get(directoryPath);

        // Hit cache.
        if (configArray) {
            debug(`Cache hit: ${directoryPath}.`);
            return configArray;
        }
        debug(`No cache found: ${directoryPath}.`);

        const homePath = os.homedir();

        // Consider this is root.
        if (directoryPath === homePath && cwd !== homePath) {
            debug("Stop traversing because of considered root.");
            configCache.set(directoryPath, baseConfigArray);
            return baseConfigArray;
        }

        // Load the config on this directory.
        try {
            configArray = configArrayFactory.loadOnDirectory(directoryPath);
        } catch (error) {
            /* istanbul ignore next */
            if (error.code === "EACCES") {
                debug("Stop traversing because of 'EACCES' error.");
                configCache.set(directoryPath, baseConfigArray);
                return baseConfigArray;
            }
            throw error;
        }

        if (configArray.length > 0 && configArray.root) {
            debug("Stop traversing because of 'root:true'.");
            configCache.set(directoryPath, configArray);
            return configArray;
        }

        // Load from the ancestors and merge it.
        const parentPath = path.dirname(directoryPath);
        const parentConfigArray = parentPath && parentPath !== directoryPath
            ? this._loadConfigInAncestors(parentPath)
            : baseConfigArray;

        if (configArray.length > 0) {
            configArray.unshift(...parentConfigArray);
        } else {
            configArray = parentConfigArray;
        }

        // Cache and return.
        configCache.set(directoryPath, configArray);
        return configArray;
    }

    /**
     * Finalize a given config array.
     * Concatinate `--config` and other CLI options.
     * @param {ConfigArray} configArray The parent config array.
     * @param {string} directoryPath The path to the leaf directory to find config files.
     * @returns {ConfigArray} The loaded config.
     * @private
     */
    _finalizeConfigArray(configArray, directoryPath) {
        const {
            cliConfigArray,
            configArrayFactory,
            finalizeCache,
            useEslintrc
        } = internalSlotsMap.get(this);

        let finalConfigArray = finalizeCache.get(configArray);

        if (!finalConfigArray) {
            finalConfigArray = configArray;

            // Load the personal config if there are no regular config files.
            if (
                useEslintrc &&
                configArray.every(c => !c.filePath) &&
                cliConfigArray.every(c => !c.filePath) // `--config` option can be a file.
            ) {
                debug("Loading the config file of the home directory.");

                finalConfigArray = configArrayFactory.loadOnDirectory(
                    os.homedir(),
                    { name: "PersonalConfig", parent: finalConfigArray }
                );
            }

            // Apply CLI options.
            if (cliConfigArray.length > 0) {
                finalConfigArray = finalConfigArray.concat(cliConfigArray);
            }

            // Validate rule settings and environments.
            validateConfigArray(finalConfigArray);

            // Cache it.
            finalizeCache.set(configArray, finalConfigArray);

            debug(
                "Configuration was determined: %o on %s",
                finalConfigArray,
                directoryPath
            );
        }

        if (useEslintrc && finalConfigArray.length === 0) {
            throw new ConfigurationNotFoundError(directoryPath);
        }

        return finalConfigArray;
    }
}

//------------------------------------------------------------------------------
// Public Interface
//------------------------------------------------------------------------------

module.exports = { CascadingConfigArrayFactory };
