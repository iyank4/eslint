/**
 * @fileoverview `ExtractedConfig` class.
 *
 * `ExtractedConfig` class expresses a final configuration for a specific file.
 *
 * It provides one method.
 *
 * - `toCompatibleObjectAsConfigFileContent()`
 *      Convert this configuration to the compatible object as the content of
 *      config files. It converts the loaded parser and plugins to strings.
 *      `CLIEngine#getConfigForFile(filePath)` method uses this method.
 *
 * `ConfigArray#extractConfig(filePath)` creates a `ExtractedConfig` instance.
 *
 * @author Toru Nagashima <https://github.com/mysticatea>
 */
"use strict";

// For VSCode intellisense
/** @typedef {InstanceType<import("./config-dependency")["ConfigDependency"]>} ConfigDependency */

/**
 * The class for extracted config data.
 */
class ExtractedConfig {
    constructor() {

        /**
         * Environments.
         * @type {Record<string, boolean>}
         */
        this.env = {};

        /**
         * Global variables.
         * @type {Record<string, boolean|string>}
         */
        this.globals = {};

        /**
         * Parser definition.
         * @type {null|ConfigDependency}
         */
        this.parser = null;

        /**
         * Options for the parser.
         * @type {Object}
         */
        this.parserOptions = {};

        /**
         * Plugin definitions.
         * @type {Record<string, ConfigDependency>}
         */
        this.plugins = {};

        /**
         * Processor ID.
         * @type {string|null}
         */
        this.processor = null;

        /**
         * Rule settings.
         * @type {Record<string, Array>}
         */
        this.rules = {};

        /**
         * Shared settings.
         * @type {Object}
         */
        this.settings = {};
    }

    /**
     * Convert this config to the compatible object as a config file content.
     * @returns {Object} The converted object.
     */
    toCompatibleObjectAsConfigFileContent() {
        const {
            processor: _ignore, // eslint-disable-line no-unused-vars
            ...config
        } = this;

        config.parser = config.parser && config.parser.filePath;
        config.plugins = Object.keys(config.plugins).reverse();

        return config;
    }
}

module.exports = { ExtractedConfig };
