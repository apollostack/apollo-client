import node from 'rollup-plugin-node-resolve';
import babel from 'rollup-plugin-babel';
import cjs from 'rollup-plugin-commonjs';
import replace from 'rollup-plugin-replace';
import { terser as minify } from 'rollup-plugin-terser';
import gzipPlugin from 'rollup-plugin-gzip'

function build({ outputPrefix, externals = [], gzip = false }) {
  return {
    input: './src/index.js',
    output: {
      file: `./public/js/${outputPrefix}.min.js`,
      format: 'cjs',
      sourcemap: true
    },
    external(id) {
      return externals.indexOf(id) >= 0;
    },
    treeshake: true,
    plugins: [
      node(),
      replace({
        'process.env.NODE_ENV': JSON.stringify('production')
      }),
      babel({
        exclude: 'node_modules/**',
        presets: [require('@babel/preset-react')]
      }),
      cjs({
        namedExports: {
          'react': [
            'createContext',
            'createElement',
            'useRef',
            'useContext',
            'useReducer',
            'useEffect',
            'useState'
          ],
          'react-dom': [
            'render',
          ],
        }
      }),
      minify({
        mangle: {
          toplevel: true
        },
        compress: {
          dead_code: true,
          global_defs: {
            '@process.env.NODE_ENV': JSON.stringify('production')
          }
        }
      }),
      gzip && gzipPlugin()
    ]
  };
}

export default [
  build({
    externals: [],
    outputPrefix: 'app',
    gzip: true
  }),
  build({
    externals: ['react', 'react-dom'],
    outputPrefix: 'app-no-react',
    gzip: true
  })
];
