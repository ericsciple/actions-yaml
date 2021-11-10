// Generated using webpack-cli https://github.com/webpack/webpack-cli

const path = require("path")
const TerserPlugin = require('terser-webpack-plugin');

const isProduction = true //process.env.NODE_ENV == "production"

const config = {
  entry: "./lib/main.js",
  output: {
    path: path.resolve(__dirname, "dist"),
  },
  plugins: [
    // Add your plugins here
    // Learn more about plugins from https://webpack.js.org/configuration/plugins/
  ],
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/i,
        exclude: /[\\/]node_modules[\\/]/,
        loader: "babel-loader",
      }

      // Add your rules for custom modules here
      // Learn more about loaders from https://webpack.js.org/loaders/
    ],
  },
  optimization: {
    minimizer: [
      new TerserPlugin({
        // Use multi-process parallel running to improve the build speed
        // Default number of concurrent runs: os.cpus().length - 1
        parallel: true
      })
    ]
  }
}

module.exports = () => {
  if (isProduction) {
    config.mode = "production"
  } else {
    config.mode = "development"
  }
  return config
}
