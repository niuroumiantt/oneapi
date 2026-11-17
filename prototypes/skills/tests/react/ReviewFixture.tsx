'use client';
import {useEffect, useState} from 'react';
import _ from 'lodash';

type User = {id:string; name:string};
type Order = {id:string; title:string};
export async function loadDashboard(userId:string) {
  const userResponse = await fetch(`/api/users/${userId}`);
  const user:User = await userResponse.json();
  const ordersResponse = await fetch(`/api/orders?user=${userId}`);
  const orders:Order[] = await ordersResponse.json();
  return {user, orders};
}
export function SearchBox({query}:{query:string}) {
  const [results,setResults] = useState<Order[]>([]);
  useEffect(()=>{
    fetch(`/api/search?q=${encodeURIComponent(query)}`)
      .then(r=>r.json()).then(setResults);
  },[query]);
  const ordered = _.sortBy(results, ['title']);
  return <ul>{ordered.map(item=><li key={item.id}>{item.title}</li>)}</ul>;
}
export function Greeting({user}:{user:User}) {
  return <p>Hello, {user.name}</p>;
}
