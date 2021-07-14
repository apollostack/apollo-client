---
title: View integrations
subtitle: Using Apollo Client with your view layer
description: How to use Apollo Client with the view layer your application is developed in!
---

## React

Apollo Client's built-in React support allows you to fetch data from your GraphQL server and use it in building complex and reactive UIs using the React framework. Apollo Client may be used in any context that React may be used. In the browser, in React Native, or in Node.js when you want to server side render.

Apollo Client, unlike some other tools in the React ecosystem, requires _no_ complex build setup to get up and running. As long as you have a GraphQL server you can get started building out your application with React immediately. Apollo Client's React functionality works out of the box with both [`create-react-app`](https://github.com/facebookincubator/create-react-app) and [React Native](http://facebook.github.io/react-native
) with a single install and with no extra hassle configuring Babel or other JavaScript tools.

## Vue

A [Vue.js](https://vuejs.org/) integration is maintained by Guillaume Chau ([@Akryum](https://github.com/Akryum)). See the Github [repository](https://github.com/Akryum/vue-apollo) for more details.

## Svelte

A [Svelte](https://svelte.dev) integration is maintained by Tim Hall ([@timhall](https://github.com/timhall)). See the Github [repository](https://github.com/timhall/svelte-apollo) for more details.

## Angular

An [Angular](https://angular.io) integration is maintained by Kamil Kisiela ([@kamilkisiela](https://github.com/kamilkisiela)). See the [website](https://apollo-angular.com) for more details.

## Ember

An [Ember](http://emberjs.com/) integration is maintained by Josemar Luedke ([@josemarluedke](https://github.com/josemarluedke)). See the Github [repository](https://github.com/ember-graphql/ember-apollo-client) for more details. The creator of the project is Blake Gentry ([@bgentry](https://github.com/bgentry)).

## Web Components

Web components are the browser-built-in component APIs. They are defined in a framework-agnostic way, using either vanilla JS or libraries like [`lit-element`](https://lit-element.polymer-project.org) or [`hybrids`](https://hybrids.js.org).

- [apollo-elements](https://github.com/apollo-elements/apollo-elements) includes support for `lit-element`, `gluon`, `hybrids`, and `polymer`, as well as providing class mixin functions so you can integrate Apollo into vanilla elements or any other web component library. Apollo Elements is maintained by Benny Powers ([@bennypowers](https://github.com/bennypowers)).
- [polymer-apollo](https://github.com/aruntk/polymer-apollo) is a separate [Polymer](https://www.polymer-project.org/) integration maintained by Arun Kumar T K ([@aruntk](https://github.com/aruntk)).
